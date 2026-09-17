import express from 'express'
import { choice, TypeSafeClient } from '@typesafe-ai/sdk'
import {
  buildChessTacticalContext,
  buildIllegalMoveRetryPrompt,
  SHARED_TACTICAL_CHECKLIST,
  LegalMoveInfo,
} from './src/shared/chess.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const litellmUrl = process.env.LITELLM_PROXY_URL
const litellmApiKey = process.env.LITELLM_API_KEY ?? process.env.OPENAI_API_KEY
const lunaPricing = { input: 0.2, cache: 0.02, output: 1.2 }
const upstreamTimeoutMs = 120_000

function logModelRequest(options: {
  target: string
  model: string
  turn: string
  fen: string
  asciiBoard: string
  whitePieces: string[]
  blackPieces: string[]
  opponentLastMove: string
  moveHistoryFormatted?: string
  legalMoves: Array<{ uci: string; san: string }>
  questionOrPrompt?: string
}) {
  const line = '─'.repeat(60)
  console.log(`\n\x1b[36m┌${line}┐\x1b[0m`)
  console.log(`\x1b[36m│\x1b[0m \x1b[1m\x1b[33mREQUEST TO AI:\x1b[0m \x1b[32m${options.model}\x1b[0m (\x1b[35m${options.target}\x1b[0m) playing \x1b[1m${options.turn}\x1b[0m`)
  console.log(`\x1b[36m├${line}┤\x1b[0m`)
  console.log(`\x1b[1mFEN:\x1b[0m ${options.fen}`)
  console.log(`\x1b[1mOpponent Last Move:\x1b[0m ${options.opponentLastMove}`)
  if (options.moveHistoryFormatted) {
    console.log(`\x1b[1mHistory:\x1b[0m ${options.moveHistoryFormatted}`)
  }
  console.log(`\x1b[1mLegal Moves (${options.legalMoves.length}):\x1b[0m ${options.legalMoves.map((m) => `${m.uci} (${m.san})`).join(', ')}`)
  console.log(`\x1b[36m├${line}┤\x1b[0m`)
  console.log(`\x1b[1mBoard Layout:\x1b[0m\n${options.asciiBoard}`)
  console.log(`\x1b[36m├${line}┤\x1b[0m`)
  console.log(`\x1b[1mPiece Locations:\x1b[0m`)
  console.log(`  \x1b[37mWhite:\x1b[0m ${options.whitePieces.join(', ')}`)
  console.log(`  \x1b[90mBlack:\x1b[0m ${options.blackPieces.join(', ')}`)
  if (options.questionOrPrompt) {
    console.log(`\x1b[36m├${line}┤\x1b[0m`)
    console.log(`\x1b[1mPrompt / Question:\x1b[0m\n${options.questionOrPrompt}`)
  }
  console.log(`\x1b[36m└${line}┘\x1b[0m\n`)
}

function providerFailure(error: unknown, fallback: string) {
  const candidate = error as { status?: number; statusCode?: number; code?: string; message?: string }
  const status = candidate.status ?? candidate.statusCode
  const message = candidate.message ?? fallback
  const normalized = `${candidate.code ?? ''} ${message}`.toLowerCase()

  if (status === 429 || normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return { status: 429, code: 'RATE_LIMIT', error: 'The model provider is rate-limiting requests.', detail: 'Wait a moment and retry.' }
  }
  if (normalized.includes('quota') || normalized.includes('insufficient') || normalized.includes('billing')) {
    return { status: 402, code: 'QUOTA_EXCEEDED', error: 'The model provider quota has been reached.', detail: 'The model is temporarily unavailable until the provider quota resets.' }
  }
  if (status === 401 || status === 403 || normalized.includes('authentication') || normalized.includes('unauthorized')) {
    return { status: 502, code: 'PROVIDER_AUTH', error: 'The model provider rejected the server credentials.', detail: 'Check the configured provider API key.' }
  }
  if (status === 408 || status === 504 || normalized.includes('timeout') || normalized.includes('timed out')) {
    return { status: 504, code: 'UPSTREAM_TIMEOUT', error: 'The model provider took too long to respond.', detail: 'The request was stopped after 120 seconds. Retry the move.' }
  }
  return { status: 502, code: 'UPSTREAM_ERROR', error: fallback, detail: message }
}

app.use(express.json())

app.post('/api/jev/move', async (request, response) => {
  const startedAt = performance.now()
  const { fen, legalMoves, lastMove, history } = request.body as {
    fen?: string
    legalMoves?: LegalMoveInfo[]
    lastMove?: { uci: string; san: string } | null
    history?: string[]
  }

  if (!fen || !Array.isArray(legalMoves) || legalMoves.length === 0 || legalMoves.length > 255) {
    response.status(400).json({ error: 'A FEN and between 1 and 255 legal moves are required.' })
    return
  }

  try {
    if (!process.env.TYPESAFE_API_KEY) {
      response.status(503).json({ error: 'TYPESAFE_API_KEY is not configured on the server.' })
      return
    }

    const context = buildChessTacticalContext({ fen, legalMoves, lastMove, history })

    logModelRequest({
      target: 'TypeSafe AI SDK',
      model: 'jev-latest',
      turn: context.turn,
      fen: context.fen,
      asciiBoard: context.asciiBoard,
      whitePieces: context.whitePieces,
      blackPieces: context.blackPieces,
      opponentLastMove: context.opponentLastMove,
      moveHistoryFormatted: context.moveHistoryFormatted,
      legalMoves: context.legalMoves,
      questionOrPrompt: `Goal: Choose the best move to win the game by maximizing overall positional quality (not short-sighted material grabbing).\n${SHARED_TACTICAL_CHECKLIST}`,
    })

    const client = new TypeSafeClient()
    let totalInputTokens = 0
    let totalOutputTokens = 0

    const makeJevCall = async (promptOverride?: string) => {
      const result = await client.systemOne({
        state: {
          position_fen: context.fen,
          side_to_move: context.turn,
          board_layout: context.asciiBoard,
          white_piece_locations: context.whitePieces,
          black_piece_locations: context.blackPieces,
          opponent_last_move: context.opponentLastMove,
          move_history: context.moveHistoryFormatted,
          legal_moves: context.legalMoves,
        },
        questions: {
          move: choice(
            promptOverride ??
              `You are playing as ${context.turn}. Your goal is to make the best possible move to win the game by achieving the strongest position overall. Do not focus on winning material immediately if it damages your position, king safety, or coordination.
${SHARED_TACTICAL_CHECKLIST}
Move history: ${context.moveHistoryFormatted}
Opponent's last move: ${context.opponentLastMove}
Choose only the provided legal move keys.`,
            Object.fromEntries(context.legalMoves.map(({ uci, san }) => [uci, `Play ${san} (${uci})`])),
          ),
        },
      })
      totalInputTokens += result.usage?.input_tokens ?? 0
      totalOutputTokens += result.usage?.output_tokens ?? 0
      return result
    }

    let result = await makeJevCall()
    let answer = result.answers.move
    let selected = legalMoves.find((move) => move.uci === answer.choice)

    // Retry once ONLY if the returned choice is not in the legal move list
    if (!selected) {
      console.warn(`[Jev Illegal/Missing Move] "${answer.choice}" not in legal moves. Retrying once...`)
      result = await makeJevCall(
        `Your previous selection was not found in the legal moves list.
Please choose a legal move for ${context.turn} from the provided keys.`,
      )
      answer = result.answers.move
      selected = legalMoves.find((move) => move.uci === answer.choice)
      if (!selected) {
        response.status(502).json({ error: 'Jev returned a move outside the legal move set.' })
        return
      }
    }

    response.json({
      move: selected,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      model: result.model,
      telemetry: {
        durationMs: Math.round(performance.now() - startedAt),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: (totalInputTokens * 0.042) / 1_000_000,
      },
    })
  } catch (error) {
    const failure = providerFailure(error, 'Jev could not make a move.')
    console.error('Jev move request failed:', failure.code)
    response.status(failure.status).json({ ...failure, model: 'jev-latest' })
  }
})

app.post('/api/opponent/move', async (request, response) => {
  const startedAt = performance.now()
  const { fen, legalMoves, model, lastMove, history } = request.body as {
    fen?: string
    model?: string
    legalMoves?: LegalMoveInfo[]
    lastMove?: { uci: string; san: string } | null
    history?: string[]
  }
  const allowedModels = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gemini-3.7-flash'])

  if (!fen || !model || !allowedModels.has(model) || !Array.isArray(legalMoves) || legalMoves.length === 0) {
    response.status(400).json({ error: 'A valid model, FEN, and legal move list are required.' })
    return
  }
  if (!litellmApiKey || !litellmUrl) {
    response.status(503).json({ error: 'LITELLM_PROXY_URL and LITELLM_API_KEY or OPENAI_API_KEY must be configured on the server.' })
    return
  }

  try {
    const context = buildChessTacticalContext({ fen, legalMoves, lastMove, history })

    logModelRequest({
      target: 'LiteLLM Proxy',
      model,
      turn: context.turn,
      fen: context.fen,
      asciiBoard: context.asciiBoard,
      whitePieces: context.whitePieces,
      blackPieces: context.blackPieces,
      opponentLastMove: context.opponentLastMove,
      moveHistoryFormatted: context.moveHistoryFormatted,
      legalMoves: context.legalMoves,
      questionOrPrompt: `System: You are an expert chess engine playing as ${context.turn}. Goal: Play the best move to win the game (best overall position, not just immediate material gains).\n${SHARED_TACTICAL_CHECKLIST}`,
    })

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `You are an expert grandmaster chess engine playing as ${context.turn}.
Goal: Make the best possible move to win the game. Focus on overall positional strength, king safety, piece activity, and long-term advantages—not merely grabbing material immediately if it compromises your position.
${SHARED_TACTICAL_CHECKLIST}
Analyze the current board position, piece coordinates, move history, opponent's previous move, and legal candidate moves. Return ONLY the chosen legal UCI move (e.g. e2e4), with no extra text or punctuation.`,
      },
      {
        role: 'user',
        content: `CURRENT BOARD POSITION:
FEN: ${context.fen}
Side to move: ${context.turn}

MOVE HISTORY:
${context.moveHistoryFormatted}

BOARD LAYOUT (Rank 8 down to 1):
${context.asciiBoard}

PIECE LOCATIONS:
White pieces: ${context.whitePieces.join(', ')}
Black pieces: ${context.blackPieces.join(', ')}

OPPONENT'S LAST MOVE:
${context.opponentLastMove}

LEGAL MOVES:
${context.legalMoves.map((move) => `${move.uci} (${move.san})`).join(', ')}

Choose the strongest legal move for ${context.turn} to maximize long-term winning chances and overall position, and return only its UCI notation.`,
      },
    ]

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCachedTokens = 0

    const sendUpstream = async (msgList: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => {
      const upstream = await fetch(litellmUrl, {
        signal: AbortSignal.timeout(upstreamTimeoutMs),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${litellmApiKey}` },
        body: JSON.stringify({ model, messages: msgList }),
      })

      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          prompt_tokens_details?: { cached_tokens?: number }
        }
        response_cost?: number
        error?: { message?: string; type?: string; code?: string }
      }

      if (!upstream.ok) {
        const failure = providerFailure(
          { status: upstream.status, code: data.error?.code ?? data.error?.type, message: data.error?.message },
          `LiteLLM returned ${upstream.status}`,
        )
        const retryAfter = upstream.headers.get('retry-after')
        const errorWithMeta = Object.assign(new Error(failure.error), {
          status: failure.status,
          code: failure.code,
          detail: failure.detail,
          retryAfter,
        })
        throw errorWithMeta
      }

      const inp = data.usage?.prompt_tokens ?? 0
      const out = data.usage?.completion_tokens ?? 0
      const cached = Math.min(data.usage?.prompt_tokens_details?.cached_tokens ?? 0, inp)
      totalInputTokens += inp
      totalOutputTokens += out
      totalCachedTokens += cached

      const rawContent = data.choices?.[0]?.message?.content?.trim() ?? ''
      const rawMove = rawContent.match(/[a-h][1-8][a-h][1-8][qrbn]?/i)?.[0]?.toLowerCase()
      return { rawContent, rawMove }
    }

    let { rawContent, rawMove } = await sendUpstream(messages)
    let selected = legalMoves.find((move) => move.uci === rawMove)

    // Retry once ONLY if the returned text is not a legal move
    if (!selected) {
      console.warn(`[${model} Illegal Move] Output "${rawContent}" parsed as "${rawMove}". Retrying once...`)
      const retryPrompt = buildIllegalMoveRetryPrompt(rawContent || 'empty', legalMoves, context.turn)
      const retryMessages = [
        ...messages,
        { role: 'assistant' as const, content: rawContent },
        { role: 'user' as const, content: retryPrompt },
      ]

      const retryResult = await sendUpstream(retryMessages)
      selected = legalMoves.find((move) => move.uci === retryResult.rawMove)
      if (!selected) {
        throw new Error('The selected model did not return a legal UCI move.')
      }
    }

    const billableInputTokens = totalInputTokens - totalCachedTokens
    const costUsd =
      (billableInputTokens * lunaPricing.input + totalCachedTokens * lunaPricing.cache + totalOutputTokens * lunaPricing.output) / 1_000_000

    response.json({
      move: selected,
      model,
      telemetry: {
        durationMs: Math.round(performance.now() - startedAt),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
      },
    })
  } catch (error) {
    const failure = providerFailure(error, 'The selected model could not make a move.')
    console.error('Opponent move request failed:', failure.code)
    response.status(failure.status).json({ ...failure, model })
  }
})

app.listen(port, () => console.log(`Jev server listening on http://localhost:${port}`))
