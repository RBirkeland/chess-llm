export interface StockfishEvalResult {
  scoreCp: number | null // Evaluation in centipawns from White's perspective (+ = White advantage, - = Black advantage)
  mate: number | null // Mate in moves from White's perspective (+ = White mate, - = Black mate)
  whiteWinProb: number // 0 to 100
  blackWinProb: number // 0 to 100
  displayEval: string // e.g. "+1.4", "-0.8", "0.0", "M2", "-M1"
  bestMove: string | null // e.g. "e2e4"
  depth: number
  isEvaluating: boolean
}

/**
 * Converts a centipawn score (from White's perspective) into win probability percentages.
 * Uses the standard logistic model calibrated for standard chess engines (Lichess/FIDE calibration).
 */
export function convertCpToWinProbability(scoreCp: number): { whiteProb: number; blackProb: number } {
  // Sigmoid formula: W = 100 / (1 + exp(-0.00368208 * scoreCp))
  const whiteProbRaw = 100 / (1 + Math.exp(-0.00368208 * scoreCp))
  // Clamp between 1% and 99% unless forced mate
  const whiteProbClamped = Math.max(1, Math.min(99, Math.round(whiteProbRaw * 10) / 10))
  const blackProbClamped = Math.round((100 - whiteProbClamped) * 10) / 10
  return {
    whiteProb: whiteProbClamped,
    blackProb: blackProbClamped,
  }
}

/**
 * Formats evaluation values for display.
 */
export function formatEvaluationDisplay(scoreCp: number | null, mate: number | null): string {
  if (mate !== null) {
    if (mate > 0) return `M${mate}`
    if (mate < 0) return `-M${Math.abs(mate)}`
    return '0.0'
  }
  if (scoreCp === null) return '0.0'
  const pawns = scoreCp / 100
  if (pawns > 0) return `+${pawns.toFixed(1)}`
  if (pawns < 0) return pawns.toFixed(1)
  return '0.0'
}

/**
 * Parses a UCI 'info' line from Stockfish.
 * In UCI, 'score cp X' or 'score mate Y' is provided from the perspective of the side to move!
 */
export function parseUciInfoLine(line: string, turnColor: 'w' | 'b'): Partial<StockfishEvalResult> | null {
  if (!line.startsWith('info ') || !line.includes('score ')) {
    return null
  }

  const depthMatch = line.match(/\bdepth\s+(\d+)/)
  const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0

  const pvMatch = line.match(/\bpv\s+([a-h1-8]{4,5})/)
  const bestMove = pvMatch ? pvMatch[1] : null

  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
  if (mateMatch) {
    const rawMate = parseInt(mateMatch[1], 10)
    // Adjust to White perspective
    const mateInWhitePerspective = turnColor === 'w' ? rawMate : -rawMate
    const isWhiteMate = mateInWhitePerspective > 0
    return {
      depth,
      bestMove,
      mate: mateInWhitePerspective,
      scoreCp: isWhiteMate ? 10000 : -10000,
      whiteWinProb: isWhiteMate ? 100 : 0,
      blackWinProb: isWhiteMate ? 0 : 100,
      displayEval: formatEvaluationDisplay(null, mateInWhitePerspective),
    }
  }

  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
  if (cpMatch) {
    const rawCp = parseInt(cpMatch[1], 10)
    // Adjust to White perspective
    const cpInWhitePerspective = turnColor === 'w' ? rawCp : -rawCp
    const { whiteProb, blackProb } = convertCpToWinProbability(cpInWhitePerspective)
    return {
      depth,
      bestMove,
      mate: null,
      scoreCp: cpInWhitePerspective,
      whiteWinProb: whiteProb,
      blackWinProb: blackProb,
      displayEval: formatEvaluationDisplay(cpInWhitePerspective, null),
    }
  }

  return null
}

export const INITIAL_EVAL: StockfishEvalResult = {
  scoreCp: 25,
  mate: null,
  whiteWinProb: 52,
  blackWinProb: 48,
  displayEval: '+0.3',
  bestMove: 'e2e4',
  depth: 1,
  isEvaluating: false,
}
