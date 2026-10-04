import { describe, expect, it } from 'vitest'

import { createImageResultDefinition } from '../src/client/image-result-node.js'

const attachment = {
  attachmentId: 'sha256:promoted-image',
  mediaType: 'image/png',
  bytes: 4096,
  width: 512,
  height: 512,
}

function location(turn: number, endSeq?: number) {
  return {
    kind: 'turn' as const,
    turn: {
      turn,
      start: { seq: 1 },
      end: endSeq === undefined ? undefined : { seq: endSeq },
      status: endSeq === undefined ? 'open' as const : 'closed' as const,
      steps: [],
      data: { get: () => undefined },
    },
  }
}

function match(event: Record<string, unknown>, role: 'start' | 'update', endSeq?: number) {
  return { event, role, location: location(1, endSeq), view: undefined }
}

function context(state: unknown, matches: readonly ReturnType<typeof match>[], endSeq?: number, id = 'result:4') {
  return {
    key: `dsh-image-result:${id}`,
    kind: 'dsh-image-result',
    id,
    matches,
    start: matches[0],
    state,
    current: new Map(),
    location: location(1, endSeq),
  }
}

describe('promoted image result conversation node', () => {
  const resultEvent = {
    type: 'tool/result',
    seq: 4,
    time: 4000,
    data: {
      turn: 1,
      step: 1,
      message: { source: { callId: 'call-1' }, content: [] },
      meta: {
        kind: 'dazi-image-gen',
        attachment,
        prompt: 'a promoted image',
        provider: 'google',
        model: 'gemini',
        output: '1024x1024',
      },
    },
  }
  const reader = { previous: () => undefined }

  it('keeps a finished image at its own result event even after the turn closes', () => {
    const definition = createImageResultDefinition()
    const resultMatch = match(resultEvent, 'start', 8)
    const state = definition.start(context(undefined, [resultMatch], 8), resultMatch, reader)
    expect(definition.match({ type: 'assistant/message', seq: 7, data: { turn: 1 } })).toBeNull()
    expect(definition.match({ type: 'turn/end', seq: 8, data: { turn: 1 } })).toBeNull()
    expect(definition.buildViewNode(context(state, [resultMatch], 8))).toMatchObject({
      kind: 'dsh-image-result',
      anchorSeq: 4,
      location: { kind: 'session' },
      data: { results: [{ attachment, prompt: 'a promoted image' }] },
    })
  })

  it('keeps two images in the same turn at their separate result positions', () => {
    const definition = createImageResultDefinition()
    const secondAttachment = { ...attachment, attachmentId: 'sha256:second-image' }
    const secondResultEvent = {
      ...resultEvent,
      seq: 10,
      data: {
        ...resultEvent.data,
        message: { source: { callId: 'call-2' }, content: [] },
        meta: { ...resultEvent.data.meta, attachment: secondAttachment, prompt: 'second image' },
      },
    }
    const firstIdentity = definition.match(resultEvent)
    const secondIdentity = definition.match(secondResultEvent)
    expect(firstIdentity).toMatchObject({ role: 'start' })
    expect(secondIdentity).toMatchObject({ role: 'start' })
    expect(firstIdentity?.id).not.toBe(secondIdentity?.id)

    const firstMatch = match(resultEvent, 'start', 13)
    const secondMatch = match(secondResultEvent, 'start', 13)
    const firstState = definition.start(context(undefined, [firstMatch], 13, firstIdentity!.id), firstMatch, reader)
    const secondState = definition.start(context(undefined, [secondMatch], 13, secondIdentity!.id), secondMatch, reader)
    expect(definition.buildViewNode(context(firstState, [firstMatch], 13, firstIdentity!.id))).toMatchObject({
      anchorSeq: 4,
      location: { kind: 'session' },
      data: { results: [{ attachment, prompt: 'a promoted image' }] },
    })
    expect(definition.buildViewNode(context(secondState, [secondMatch], 13, secondIdentity!.id))).toMatchObject({
      anchorSeq: 10,
      location: { kind: 'session' },
      data: { results: [{ attachment: secondAttachment, prompt: 'second image' }] },
    })
  })

  it('ignores unrelated and failed tool results', () => {
    const unrelated = {
      type: 'tool/result',
      seq: 4,
      time: 4000,
      data: { turn: 1, step: 1, message: { source: { callId: 'call-1' }, content: [] }, meta: { kind: 'other' } },
    }
    expect(createImageResultDefinition().match(unrelated)).toBeNull()
  })

  it('keeps rendering metadata from the pre-rename package', () => {
    const definition = createImageResultDefinition()
    const legacyEvent = {
      ...resultEvent,
      data: { ...resultEvent.data, meta: { ...resultEvent.data.meta, kind: 'dsh-image-gen' } },
    }
    const identity = definition.match(legacyEvent)
    expect(identity).toMatchObject({ role: 'start' })
    const legacyMatch = match(legacyEvent, 'start', 8)
    const state = definition.start(context(undefined, [legacyMatch], 8, identity!.id), legacyMatch, reader)
    expect(definition.buildViewNode(context(state, [legacyMatch], 8, identity!.id))).toMatchObject({
      data: { results: [{ attachment, prompt: 'a promoted image' }] },
    })
  })
})

describe('ptc dispatch image results (#38)', () => {
  const dispatchEvent = {
    type: 'tool/ptc-dispatch',
    seq: 19,
    time: 19000,
    data: {
      rootCallId: 'run-1',
      parentCallId: 'run-1',
      subCallId: 'sub-1',
      name: 'edit_image',
      arguments: {
        prompt: 'a q-version comic',
        aspect_ratio: '2:3',
        source_attachment_id: 'sha256:source-image',
      },
      isError: false,
      content: [
        {
          type: 'text',
          text: 'Edited one image with openai-compat/gpt-image-2 (2:3). Attachment ID: sha256:ptc-image. The edited image is attached to the conversation. It was also saved to the workspace as image/image-1.png. Respond to the user without reading or searching for the image.',
        },
        {
          type: 'image',
          attachment: {
            attachmentId: 'sha256:ptc-image',
            mediaType: 'image/png',
            bytes: 2476872,
            width: 1024,
            height: 1536,
          },
        },
      ],
    },
  }

  function ptcMatch(event: Record<string, unknown>, role: 'start' | 'update' = 'start') {
    return { event, role, location: location(1), view: undefined }
  }

  function ptcContext(state: unknown, matches: readonly ReturnType<typeof ptcMatch>[]) {
    return {
      key: 'dsh-image-result:ptc:sub-1',
      kind: 'dsh-image-result',
      id: 'ptc:sub-1',
      matches,
      start: matches[0],
      state,
      current: new Map(),
      location: location(1),
    }
  }

  const reader = { previous: () => undefined }

  it('matches a successful plugin image dispatch and keys the node by sub-call', () => {
    expect(createImageResultDefinition().match(dispatchEvent)).toEqual({ id: 'ptc:sub-1', role: 'start' })
  })

  it('ignores dispatches from other tools, failed dispatches, and dispatches without a valid image', () => {
    const definition = createImageResultDefinition()
    expect(definition.match({ ...dispatchEvent, data: { ...dispatchEvent.data, name: 'read_file' } })).toBeNull()
    expect(definition.match({ ...dispatchEvent, data: { ...dispatchEvent.data, isError: true } })).toBeNull()
    expect(definition.match({ ...dispatchEvent, data: { ...dispatchEvent.data, content: [{ type: 'text', text: 'no image here' }] } })).toBeNull()
    expect(definition.match({ ...dispatchEvent, data: { ...dispatchEvent.data, content: [{ type: 'image', attachment: { attachmentId: 'sha256:x' } }] } })).toBeNull()
    expect(definition.match({ ...dispatchEvent, data: { ...dispatchEvent.data, subCallId: '' } })).toBeNull()
    // Turn-less non-dispatch events stay ignored exactly as before.
    expect(definition.match({ type: 'tool/result', seq: 20, data: { meta: { kind: 'dazi-image-gen' } } })).toBeNull()
  })

  it('builds a card node from the dispatch alone, recovering fields from the fixed summary text', () => {
    const definition = createImageResultDefinition()
    const match = ptcMatch(dispatchEvent)
    const state = definition.start(ptcContext(undefined, [match]), match, reader)

    const node = definition.buildViewNode?.(ptcContext(state, [match]))

    expect(node).toMatchObject({
      kind: 'dsh-image-result',
      anchorSeq: 19,
      location: { kind: 'session' },
      data: {
        results: [{
          attachment: { attachmentId: 'sha256:ptc-image', mediaType: 'image/png' },
          prompt: 'a q-version comic',
          provider: 'openai-compat',
          model: 'gpt-image-2',
          output: '2:3',
          savedTo: 'image/image-1.png',
          sourceAttachmentIds: ['sha256:source-image'],
        }],
      },
    })
  })

  it('merges a re-dispatch of the same sub-call without duplicating the image', () => {
    const definition = createImageResultDefinition()
    const match = ptcMatch(dispatchEvent, 'update')
    const state = definition.start(
      ptcContext(undefined, [ptcMatch(dispatchEvent)]),
      ptcMatch(dispatchEvent),
      reader,
    )

    const merged = definition.update(ptcContext(state, [match]), match)

    expect(merged.results).toHaveLength(1)
    expect(merged.results[0]).toMatchObject({ attachment: { attachmentId: 'sha256:ptc-image' } })
  })

  it('falls back to neutral provider/model when the summary text cannot be parsed', () => {
    const definition = createImageResultDefinition()
    const event = {
      ...dispatchEvent,
      data: {
        ...dispatchEvent.data,
        content: [
          { type: 'text', text: 'something unexpected happened' },
          ...dispatchEvent.data.content.filter(block => block.type === 'image'),
        ],
      },
    }
    const match = ptcMatch(event)
    const state = definition.start(ptcContext(undefined, [match]), match, reader)
    const node = definition.buildViewNode?.(ptcContext(state, [match]))

    expect(node).toMatchObject({
      data: { results: [{ prompt: 'a q-version comic', provider: '', model: '', output: '' }] },
    })
  })
})
