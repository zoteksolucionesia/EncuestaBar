import { useState, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, deleteDoc, doc, getDocs, writeBatch, updateDoc, setDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import encuestaData from './encuesta.json'
import './index.css'

const APP_TITLE = encuestaData.encuesta_bar.configuracion_general.nombre
const APP_DESC = encuestaData.encuesta_bar.configuracion_general.descripcion

function App() {
  const [view, setView] = useState('survey')
  const [step, setStep] = useState('welcome')
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0)
  const [answers, setAnswers] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [questions, setQuestions] = useState([])
  const [responses, setResponses] = useState(() => {
    const local = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
    return local.map(r => ({ ...r, timestamp: { toDate: () => new Date(r.local_timestamp) } }))
  })
  const [loading, setLoading] = useState(true)
  const [editingResponseId, setEditingResponseId] = useState(null)
  const [editingResponseData, setEditingResponseData] = useState({})

  // Branding Logo Component
  const Logo = () => (
    <div
      title="escribeme a szoteksolucionesia@gmail.com si deseas desarrollar un proyecto"
      style={{ position: 'fixed', top: '1rem', left: '1rem', zIndex: 10000, cursor: 'help' }}
    >
      <img
        src="/Logo-zotek_animado.svg"
        alt="Zotek Logo"
        style={{ height: '40px', width: 'auto' }}
        onError={(e) => {
          e.target.style.display = 'none'
          e.target.parentElement.innerHTML = '<span style="color: var(--sky-blue); font-size: 0.8rem; font-weight: bold; opacity: 0.5;">[Logo Zotek]</span>'
        }}
      />
    </div>
  )

  // URL Routing
  useEffect(() => {
    if (window.location.pathname === '/adminzo') {
      setView('admin')
    }
  }, [])

  // Sync and Listen to Questions and Responses
  useEffect(() => {
    let isMounted = true
    const syncAndListen = async () => {
      try {
        // 1. Fetch Questions (one-time, so admin edits don't get overwritten)
        const qQuestions = query(collection(db, "preguntas"), orderBy("order", "asc"))
        const questionsSnap = await getDocs(qQuestions)

        if (questionsSnap.empty) {
          console.log("Firestore questions empty, seeding from JSON...")
          try {
            const initialQuestions = encuestaData.encuesta_bar.preguntas.map((q, idx) => ({
              ...q,
              order: idx
            }))
            const batch = writeBatch(db)
            initialQuestions.forEach(q => {
              const docRef = doc(db, "preguntas", String(q.id))
              batch.set(docRef, {
                pregunta: q.pregunta,
                tipo: q.tipo,
                opciones: q.opciones || [],
                order: q.order,
                ...(q.placeholder ? { placeholder: q.placeholder } : {}),
                ...(q.descripcion ? { descripcion: q.descripcion } : {})
              })
            })
            await batch.commit()
            // Re-fetch after seeding
            const seededSnap = await getDocs(qQuestions)
            const seededData = seededSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            if (isMounted) {
              setQuestions(seededData)
              setLoading(false)
            }
          } catch (err) {
            console.error("Error seeding questions:", err)
            if (isMounted) {
              setQuestions(encuestaData.encuesta_bar.preguntas)
              setLoading(false)
            }
          }
        } else {
          const data = questionsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          if (isMounted) {
            setQuestions(data)
            setLoading(false)
          }
        }

        // 2. Listen to Responses
        const qResponses = query(collection(db, "respuestas"), orderBy("timestamp", "desc"))
        const unsubResponses = onSnapshot(qResponses, (snapshot) => {
          if (!isMounted) return
          const cloudData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          // Merge: keep cloud data, but if empty, keep local data
          setResponses(prev => cloudData.length > 0 ? cloudData : prev)
        }, (err) => {
          console.error("Firestore responses error:", err)
          if (isMounted) {
            const rawLocal = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
            const localStored = rawLocal.map(r => ({
              ...r,
              timestamp: { toDate: () => new Date(r.local_timestamp) }
            }))
            setResponses(localStored)
            setLoading(false)
          }
        })

        return () => {
          isMounted = false
          unsubResponses()
        }
      } catch (globalErr) {
        console.error("Global Firestore error:", globalErr)
        if (isMounted) {
          setQuestions(encuestaData.encuesta_bar.preguntas)
          // Load from localStorage as secondary fallback
          const rawLocal = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
          const localStored = rawLocal.map(r => ({
            ...r,
            timestamp: { toDate: () => new Date(r.local_timestamp) }
          }))
          setResponses(localStored)
          setLoading(false)
        }
      }
    }

    // Fail-safe timeout: ensure we stop loading after 3 seconds no matter what
    const failSafe = setTimeout(() => {
      if (isMounted) {
        console.log("Fail-safe timeout reached, stopping load state.")
        setQuestions(prev => prev.length > 0 ? prev : encuestaData.encuesta_bar.preguntas)
        const rawLocal = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
        const localStored = rawLocal.map(r => ({
          ...r,
          timestamp: { toDate: () => new Date(r.local_timestamp) }
        }))
        setResponses(prev => prev.length > 0 ? prev : localStored)
        setLoading(false)
      }
    }, 3000)

    syncAndListen()

    return () => {
      isMounted = false
      clearTimeout(failSafe)
    }
  }, [])

  const handleValueChange = (value) => {
    const currentQuestion = questions[currentQuestionIdx]
    if (currentQuestion.tipo === 'checkbox') {
      const current = answers[currentQuestion.id] || []
      if (current.includes(value)) {
        setAnswers({ ...answers, [currentQuestion.id]: current.filter(v => v !== value) })
      } else {
        setAnswers({ ...answers, [currentQuestion.id]: [...current, value] })
      }
    } else {
      setAnswers({ ...answers, [currentQuestion.id]: value })
    }
  }

  const nextStep = async () => {
    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1)
    } else {
      await handleSubmit()
    }
  }

  const prevStep = () => {
    if (currentQuestionIdx > 0) {
      setCurrentQuestionIdx(prev => prev - 1)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3500))

    const now = new Date()
    const newResponseForStorage = {
      ...answers,
      device: navigator.userAgent,
      local_timestamp: now.toISOString(),
      id: `local_${Date.now()}`
    }

    const localResponses = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
    localStorage.setItem('respuestas_locales', JSON.stringify([newResponseForStorage, ...localResponses]))

    // Update local state immediately so user sees it
    const displayResponse = { ...newResponseForStorage, timestamp: { toDate: () => now } }
    setResponses(prev => [displayResponse, ...prev])

    try {
      await Promise.race([
        addDoc(collection(db, "respuestas"), {
          ...answers,
          device: navigator.userAgent,
          timestamp: serverTimestamp()
        }),
        timeout
      ])
      setStep('success')
    } catch (error) {
      console.error("Submission error or timeout (proceeding to success):", error)
      // On failure or timeout, show success screen to complete the user flow
      setStep('success')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteResponse = async (id) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta respuesta?")) return
    if (id.startsWith('local_')) {
      const local = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
      const updated = local.filter(r => r.id !== id)
      localStorage.setItem('respuestas_locales', JSON.stringify(updated))
      setResponses(prev => prev.filter(r => r.id !== id))
    } else {
      await deleteDoc(doc(db, "respuestas", id))
    }
  }

  const saveEditedResponse = async (id) => {
    const dataToSave = { ...editingResponseData }
    if (id.startsWith('local_')) {
      const local = JSON.parse(localStorage.getItem('respuestas_locales') || '[]')
      const updated = local.map(r => r.id === id ? { ...r, ...dataToSave } : r)
      localStorage.setItem('respuestas_locales', JSON.stringify(updated))
      setResponses(prev => prev.map(r => r.id === id ? { ...r, ...dataToSave } : r))
    } else {
      await updateDoc(doc(db, "respuestas", id), dataToSave)
    }
    setEditingResponseId(null)
  }

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(responses.map(r => {
      const row = {
        ID: r.id,
        Fecha: r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString() : 'N/A',
        Dispositivo: r.device || 'N/A'
      }
      questions.forEach(q => {
        row[q.pregunta] = Array.isArray(r[q.id]) ? r[q.id].join(', ') : r[q.id]
      })
      return row
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Respuestas")
    XLSX.writeFile(wb, "EncuestaBar_Resultados.xlsx")
  }

  const cleanupData = async () => {
    if (!window.confirm("¿Seguro que deseas eliminar respuestas vacías o duplicadas?")) return
    const toDelete = []
    const seenHashes = new Set()

    responses.forEach(r => {
      const answerValues = questions.map(q => JSON.stringify(r[q.id]))
      const isEmpty = answerValues.every(v => !v || v === '[]' || v === '""')
      const hash = answerValues.join('|')
      const isDuplicate = seenHashes.has(hash)

      if (isEmpty || isDuplicate) {
        toDelete.push(r.id)
      } else {
        seenHashes.add(hash)
      }
    })

    for (const id of toDelete) {
      await deleteDoc(doc(db, "respuestas", id))
    }
    alert(`Se eliminaron ${toDelete.length} registros.`)
  }

  const addQuestion = async () => {
    const newId = `q${Date.now()}`
    const newQ = {
      id: newId,
      pregunta: "Nueva Pregunta",
      tipo: "radio",
      opciones: ["Opción 1"],
      order: questions.length
    }
    // Optimistic
    setQuestions([...questions, newQ])
    try {
      await setDoc(doc(db, "preguntas", newId), {
        pregunta: newQ.pregunta,
        tipo: newQ.tipo,
        opciones: newQ.opciones,
        order: newQ.order
      })
    } catch (e) { console.error(e) }
  }

  const updateQuestion = (id, data) => {
    // Update local state ONLY
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...data } : q))
  }

  const persistQuestion = async (idOfQuestion) => {
    try {
      // Always get the freshet local state from the questions array
      const latestQ = questions.find(q => q.id === idOfQuestion)
      if (!latestQ) {
        throw new Error("Pregunta no encontrada en el estado local")
      }

      const docId = String(latestQ.id)
      await setDoc(doc(db, "preguntas", docId), {
        pregunta: latestQ.pregunta,
        tipo: latestQ.tipo,
        opciones: latestQ.opciones || [],
        order: latestQ.order || 0
      }, { merge: true })

      alert("¡Pregunta guardada correctamente!")
    } catch (e) {
      console.error("Firestore save error:", e)
      alert("Error al guardar: " + e.message)
    }
  }

  const removeQuestion = async (id) => {
    if (!window.confirm("¿Eliminar esta pregunta?")) return
    // Optimistic
    setQuestions(questions.filter(q => q.id !== id))
    try {
      await deleteDoc(doc(db, "preguntas", id))
    } catch (e) { console.error(e) }
  }

  const addOption = (q) => {
    const newOptions = [...q.opciones, "Nueva Opción"]
    updateQuestion(q.id, { opciones: newOptions })
  }

  const removeOption = (q, idx) => {
    const newOptions = q.opciones.filter((_, i) => i !== idx)
    updateQuestion(q.id, { opciones: newOptions })
  }

  const updateOptionText = (q, idx, text) => {
    const newOptions = [...q.opciones]
    newOptions[idx] = text
    updateQuestion(q.id, { opciones: newOptions })
  }

  if (loading) return <div className="app-container"><h1>Cargando...</h1></div>

  if (view === 'admin') {
    return (
      <div className="app-container" style={{ justifyContent: 'flex-start', paddingTop: '4rem', overflowY: 'auto', height: 'auto', minHeight: '100vh' }}>
        <Logo />
        <div className="admin-container" style={{ maxWidth: '1000px', width: '95%' }}>
          <div style={{
            position: 'sticky',
            top: '0',
            zIndex: 100,
            background: 'rgba(15,15,15,0.9)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
            padding: '1rem 0',
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}>
            <h1 style={{ margin: 0 }}>Panel de Administración</h1>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-secondary" style={{ margin: 0 }} onClick={() => window.location.reload()}>🔄 Actualizar</button>
              <button className="btn-secondary" style={{ margin: 0 }} onClick={() => (window.location.pathname = '/')}>Ver Encuesta</button>
            </div>
          </div>

          <div className="glass-card" style={{ marginBottom: '2rem', textAlign: 'left', maxWidth: 'none' }}>
            <h2>Estructura de la Encuesta</h2>
            <div style={{ marginBottom: '1.5rem' }}>
              {questions.map((q, qIdx) => (
                <div key={q.id} style={{ padding: '1.5rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--sky-blue)', marginBottom: '0.5rem' }}>Pregunta:</label>
                    <textarea
                      className="premium-input"
                      value={q.pregunta}
                      onChange={(e) => updateQuestion(q.id, { pregunta: e.target.value })}
                      style={{ width: '100%', minHeight: '100px', padding: '1rem', fontSize: '1rem', lineHeight: '1.4', background: 'rgba(0,0,0,0.4)', marginBottom: '1rem' }}
                    />
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--sky-blue)', marginBottom: '0.5rem' }}>Tipo:</label>
                        <select
                          className="premium-input"
                          style={{ width: '100%', padding: '0.8rem' }}
                          value={q.tipo}
                          onChange={(e) => updateQuestion(q.id, { tipo: e.target.value })}
                        >
                          <option value="radio">Selección Única</option>
                          <option value="checkbox">Selección Múltiple</option>
                          <option value="text_short">Texto Corto</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.3rem' }}>
                        <button className="btn-premium" style={{ height: '3rem', margin: 0, padding: '0 1rem', background: '#4CAF50' }} onClick={(e) => { e.preventDefault(); persistQuestion(q.id); }}>Guardar</button>
                        <button className="btn-secondary" style={{ height: '3rem', margin: 0, color: '#ff4444', borderColor: '#ff4444' }} onClick={(e) => { e.preventDefault(); removeQuestion(q.id); }}>Eliminar</button>
                      </div>
                    </div>
                  </div>

                  {(q.tipo === 'radio' || q.tipo === 'checkbox') && (
                    <div style={{ paddingLeft: '1rem' }}>
                      {q.opciones.map((opt, oIdx) => (
                        <div key={oIdx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <input
                            className="premium-input"
                            style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                            value={opt}
                            onChange={(e) => updateOptionText(q, oIdx, e.target.value)}
                          />
                          <button className="btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => removeOption(q, oIdx)}>–</button>
                        </div>
                      ))}
                      <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => addOption(q)}>+ Agregar Opción</button>
                    </div>
                  )}
                </div>
              ))}
              <button className="btn-premium" onClick={addQuestion}>+ Agregar Nueva Pregunta</button>
            </div>
          </div>

          <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
            <h3 style={{ color: 'var(--sky-blue)', marginBottom: '0.5rem' }}>Respuestas Recolectadas ({responses.length})</h3>
            <div className="admin-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={cleanupData}>Limpiar Datos</button>
              <button className="btn-premium" style={{ width: 'auto', margin: 0 }} onClick={exportToExcel}>Exportar Excel</button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="response-table">
              <thead>
                <tr>
                  <th>Acción</th>
                  <th>ID</th>
                  <th>Fecha/Hora</th>
                  <th>Dispositivo</th>
                  {questions.map(q => <th key={q.id}>{q.pregunta.slice(0, 15)}...</th>)}
                </tr>
              </thead>
              <tbody>
                {responses.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {editingResponseId === r.id ? (
                          <>
                            <button className="btn-premium" style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', background: '#4CAF50' }} onClick={() => saveEditedResponse(r.id)}>💾</button>
                            <button className="btn-secondary" style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} onClick={() => setEditingResponseId(null)}>✕</button>
                          </>
                        ) : (
                          <>
                            <button className="btn-secondary" style={{ padding: '0.2rem 0.4rem', color: 'var(--sky-blue)' }} onClick={() => {
                              setEditingResponseId(r.id)
                              setEditingResponseData(r)
                            }}>✏️</button>
                            <button className="btn-secondary" style={{ padding: '0.2rem 0.4rem', color: '#ff4444' }} onClick={() => deleteResponse(r.id)}>🗑</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td><span className="badge-id" title={r.id}>{r.id.slice(0, 6)}</span></td>
                    <td>{r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString() : '...'}</td>
                    <td>
                      <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                        {r.device ? (
                          (r.device.includes('Mobi') ? '📱 ' : '💻 ') +
                          (r.device.includes('(') ? r.device.split('(')[1].split(')')[0].split(';')[0] : r.device.slice(0, 20))
                        ) : '-'}
                      </span>
                    </td>
                    {questions.map(q => (
                      <td key={q.id}>
                        {editingResponseId === r.id ? (
                          <input
                            type="text"
                            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '0.2rem', borderRadius: '4px', width: '100%' }}
                            value={Array.isArray(editingResponseData[q.id]) ? editingResponseData[q.id].join(', ') : (editingResponseData[q.id] || '')}
                            onChange={(e) => {
                              const val = e.target.value
                              setEditingResponseData({ ...editingResponseData, [q.id]: q.tipo === 'checkbox' ? val.split(',').map(s => s.trim()) : val })
                            }}
                          />
                        ) : (
                          Array.isArray(r[q.id]) ? r[q.id].join(', ') : (r[q.id] || '-')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'welcome') {
    return (
      <div className="app-container">
        <Logo />
        <div className="glass-card">
          <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🍸</div>
          <h1>{APP_TITLE}</h1>
          <p>{APP_DESC}</p>
          <button className="btn-premium" onClick={() => setStep('questions')}>Comenzar</button>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="app-container">
        <Logo />
        <div className="glass-card">
          <div className="progress-container" style={{ marginBottom: '2rem' }}>
            <div className="progress-bar" style={{ width: '100%' }}></div>
          </div>
          <div style={{ fontSize: '4rem', marginBottom: '1.5rem', color: '#ffd700' }}>✨</div>
          <h1 style={{ color: '#ffd700', marginBottom: '1rem' }}>¡Muchas gracias!</h1>
          <p style={{ marginBottom: '2rem' }}>Tus respuestas han sido recibidas. Nos ayudarán a crear el bar perfecto para ti.</p>
          <div style={{ padding: '1rem', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '12px', textAlign: 'left', fontSize: '0.9rem' }}>
            <p>✓ Preferencias musicales registradas</p>
            <p>✓ Ambiente y horario capturados</p>
          </div>
          <button className="btn-premium" style={{ marginTop: '2rem', marginBottom: '2rem' }} onClick={() => window.location.reload()}>Finalizar</button>

          <div style={{ marginTop: '1rem', paddingTop: '2rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--sky-blue)', opacity: 0.8, margin: 0 }}>
              Encuesta desarrollada por
            </p>
            <img
              src="/Logo-zotek_animado.svg"
              alt="Zotek Soluciones IA"
              style={{ height: '80px' }}
            />
            <p style={{ fontSize: '0.85rem', color: 'var(--sky-blue)', opacity: 0.8, margin: 0 }}>
              contacto: zoteksolucionesia@gmail.com
            </p>
          </div>
        </div>
      </div>
    )
  }

  const currentQuestion = questions[currentQuestionIdx]
  const surveyProgress = questions.length > 0 ? ((currentQuestionIdx + 1) / questions.length) * 100 : 0

  if (!currentQuestion) return null

  return (
    <div className="app-container">
      <Logo />

      <div className="glass-card">
        <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${surveyProgress}%` }}></div>
          </div>
          <span style={{ color: 'var(--sky-blue)', fontSize: '0.85rem', fontWeight: 'bold' }}>
            Pregunta {currentQuestionIdx + 1} de {questions.length}
          </span>
        </div>

        <h2 style={{ marginBottom: '2rem' }}>{currentQuestion.pregunta}</h2>

        <div className="options-container" style={{ width: '100%', marginBottom: '2rem' }}>
          {(currentQuestion.tipo === 'radio' || currentQuestion.tipo === 'checkbox') && currentQuestion.opciones?.map((opt, idx) => (
            <div
              key={idx}
              className={`option-item ${Array.isArray(answers[currentQuestion.id]) ? (answers[currentQuestion.id].includes(opt) ? 'selected' : '') : (answers[currentQuestion.id] === opt ? 'selected' : '')}`}
              onClick={() => handleValueChange(opt)}
            >
              <div className={`check-circle ${currentQuestion.tipo === 'checkbox' ? 'square' : ''}`}>
                {(Array.isArray(answers[currentQuestion.id]) ? answers[currentQuestion.id].includes(opt) : answers[currentQuestion.id] === opt) && '✓'}
              </div>
              <span>{opt}</span>
            </div>
          ))}

          {currentQuestion.tipo === 'text_short' && (
            <input
              type="text"
              className="premium-input"
              placeholder={currentQuestion.placeholder || "Escribe aquí..."}
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => handleValueChange(e.target.value)}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: 'auto' }}>
          <button
            className="btn-secondary"
            style={{ flex: 1, height: '3.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            disabled={currentQuestionIdx === 0}
            onClick={prevStep}
          >
            Anterior
          </button>
          <button
            className="btn-premium"
            style={{ flex: 1, height: '3.5rem', marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            disabled={!answers[currentQuestion.id] || (Array.isArray(answers[currentQuestion.id]) && answers[currentQuestion.id].length === 0)}
            onClick={nextStep}
          >
            {isSubmitting ? 'Enviando...' : currentQuestionIdx === questions.length - 1 ? 'Finalizar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
