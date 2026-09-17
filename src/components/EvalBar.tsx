import React from 'react'
import type { StockfishEvalResult } from '../shared/stockfishEvaluator.js'

interface EvalBarProps {
  evaluation: StockfishEvalResult
  whiteModelName?: string
  blackModelName?: string
}

export const EvalBar: React.FC<EvalBarProps> = ({
  evaluation,
  whiteModelName = 'White',
  blackModelName = 'Black',
}) => {
  const { whiteWinProb, blackWinProb, displayEval, depth } = evaluation
  const blackPct = Math.round(blackWinProb)
  const whitePct = Math.round(whiteWinProb)

  return (
    <div
      className="eval-bar-wrapper"
      title={`Stockfish: White ${whiteWinProb}% vs Black ${blackWinProb}% (${displayEval}, depth ${depth})`}
    >
      <div className="eval-bar-container">
        {/* Black Advantage Fill (Top Portion) */}
        <div
          className="eval-bar-black"
          style={{ height: `${blackWinProb}%` }}
        >
          {blackWinProb >= 6 && (
            <div className="eval-score-label black-label">
              <span className="eval-pct">{blackPct}%</span>
            </div>
          )}
        </div>

        {/* White Advantage Fill (Bottom Portion) */}
        <div
          className="eval-bar-white"
          style={{ height: `${whiteWinProb}%` }}
        >
          {whiteWinProb >= 6 && (
            <div className="eval-score-label white-label">
              <span className="eval-pct">{whitePct}%</span>
            </div>
          )}
        </div>

        {/* 50% Equilibrium Indicator Line */}
        <div className="eval-bar-midline" />
      </div>

      <div className="eval-side-indicators">
        <span className="eval-indicator-top" title={`${blackModelName}: ${blackWinProb}%`}>
          B: {blackPct}%
        </span>
        <span className="eval-indicator-bottom" title={`${whiteModelName}: ${whiteWinProb}%`}>
          W: {whitePct}%
        </span>
      </div>
    </div>
  )
}
