/** Requests of the panel's settings view: prompt templates and the defaults of each server. */
import { invalid, safeHandle } from './common.mjs'

const isId = (v) => typeof v === 'string' && v !== ''

export function registerSettingsHandlers(ctx) {
  const { orca, templates } = ctx
  const handle = (name, fn) => safeHandle(orca, name, fn)

  handle('yt.templates', () => templates.list())
  handle('yt.templates.save', ({ id, name, body }) => templates.save({ id: id ?? undefined, name, body }))
  handle('yt.templates.delete', ({ id }) => (isId(id) ? templates.remove(id) : invalid('Invalid template')))
  handle('yt.templates.setDefault', ({ id }) => (isId(id) ? templates.setDefault(id) : invalid('Invalid template')))
  handle('yt.templates.restore', () => templates.restore())
}
