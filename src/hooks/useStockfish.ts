import { useEffect, useRef, useState, useCallback } from 'react'
import type { StockfishEvalResult } from '../shared/stockfishEvaluator.js'
import {
  INITIAL_EVAL,
  parseUciInfoLine,
} from '../shared/stockfishEvaluator.js'

export function useStockfish(currentFen: string, isGameOver: boolean, isCheckmate: boolean, isDraw: boolean) {
  const [evaluation, setEvaluation] = useState<StockfishEvalResult>(INITIAL_EVAL)
  const workerRef = useRef<Worker | null>(null)
  const isReadyRef = useRef(false)
  const latestFenRef = useRef(currentFen)

  useEffect(() => {
    latestFenRef.current = currentFen
  }, [currentFen])

  useEffect(() => {
    let worker: Worker | null = null

    try {
      if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        worker = new Worker('/stockfish/stockfish.js')
        workerRef.current = worker

        worker.onmessage = (event: MessageEvent) => {
          const line = typeof event.data === 'string' ? event.data : ''

          if (line === 'uciok' || line === 'readyok') {
            isReadyRef.current = true
            return
          }

          const turnColor = latestFenRef.current.split(' ')[1] === 'b' ? 'b' : 'w'
          const parsed = parseUciInfoLine(line, turnColor)
          if (parsed && (parsed.scoreCp !== undefined || parsed.mate !== undefined)) {
            setEvaluation((prev) => ({
              ...prev,
              ...parsed,
              isEvaluating: false,
            }))
          }
        }

        worker.postMessage('uci')
        worker.postMessage('isready')
      }
    } catch (err) {
      console.warn('Stockfish Web Worker could not be started:', err)
    }

    return () => {
      if (worker) {
        try {
          worker.postMessage('quit')
          worker.terminate()
        } catch {}
      }
      workerRef.current = null
      isReadyRef.current = false
    }
  }, [])

  const evaluateFen = useCallback((fen: string, depth = 13) => {
    const worker = workerRef.current
    if (worker) {
      worker.postMessage('stop')
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage(`go depth ${depth}`)
    }
  }, [])

  useEffect(() => {
    if (currentFen && !isGameOver && !isCheckmate && !isDraw) {
      evaluateFen(currentFen)
    }
  }, [currentFen, evaluateFen, isGameOver, isCheckmate, isDraw])

  const resetEval = useCallback(() => {
    setEvaluation(INITIAL_EVAL)
    if (workerRef.current) {
      workerRef.current.postMessage('stop')
      workerRef.current.postMessage(`position fen ${INITIAL_EVAL.bestMove ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : ''}`)
      workerRef.current.postMessage('go depth 12')
    }
  }, [])

  const activeEvaluation: StockfishEvalResult = isCheckmate
    ? {
        scoreCp: currentFen.split(' ')[1] === 'b' ? 10000 : -10000,
        mate: 0,
        whiteWinProb: currentFen.split(' ')[1] === 'b' ? 100 : 0,
        blackWinProb: currentFen.split(' ')[1] === 'b' ? 0 : 100,
        displayEval: currentFen.split(' ')[1] === 'b' ? '+M0' : '-M0',
        bestMove: null,
        depth: 0,
        isEvaluating: false,
      }
    : isDraw
    ? {
        scoreCp: 0,
        mate: null,
        whiteWinProb: 50,
        blackWinProb: 50,
        displayEval: '0.0',
        bestMove: null,
        depth: 0,
        isEvaluating: false,
      }
    : evaluation

  return {
    evaluation: activeEvaluation,
    evaluateFen,
    resetEval,
  }
}
