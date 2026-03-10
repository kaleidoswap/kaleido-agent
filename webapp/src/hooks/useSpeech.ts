import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultLike[]
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

export function useSpeech(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recogRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (Recognition) {
      setSupported(true)
      const recog = new Recognition()
      recog.continuous = false
      recog.interimResults = false
      recog.lang = 'en-US'
      recog.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim()
        if (transcript) onTranscript(transcript)
      }
      recog.onend = () => setListening(false)
      recog.onerror = () => setListening(false)
      recogRef.current = recog
      return () => {
        setListening(false)
        recog.onresult = null
        recog.onend = null
        recog.onerror = null
        try {
          recog.stop()
        } catch {
          // Ignore stop() errors if recognition was not active.
        }
      }
    } else {
      setSupported(false)
      recogRef.current = null
    }
  }, [onTranscript])

  const toggle = useCallback(() => {
    if (!recogRef.current) return
    if (listening) {
      recogRef.current.stop()
      setListening(false)
    } else {
      try {
        recogRef.current.start()
        setListening(true)
      } catch {
        setListening(false)
      }
    }
  }, [listening])

  return { listening, supported, toggle }
}
