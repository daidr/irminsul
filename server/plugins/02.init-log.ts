import fs from 'node:fs'
import { Writable } from 'node:stream'
import { configure, getConsoleSink, getStreamSink } from '@logtape/logtape'

const LOG_DIR = './irminsul-data/log'

function getLogFileSink() {
  const date = new Date().toISOString().slice(0, 10)
  const logPath = `${LOG_DIR}/app-${date}.log`
  const nodeStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' })
  const webStream = Writable.toWeb(nodeStream)
  return getStreamSink(webStream)
}

export default defineNitroPlugin(async () => {
  console.log('[Plugin 02] Init log')
  await configure({
    reset: true,
    sinks: {
      console: getConsoleSink(),
      file: getLogFileSink(),
    },
    loggers: [
      {
        category: ['irminsul'],
        lowestLevel: (process.env.IRMIN_APP_LOG_LEVEL as any) || 'info',
        sinks: ['console', 'file'],
      },
      {
        category: ['logtape', 'meta'],
        sinks: process.env.NODE_ENV === 'development' ? ['console'] : [],
      },
    ],
  })
})
