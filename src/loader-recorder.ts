import { version } from 'rrweb-v1/package.json'

// Same as loader-globals.ts except includes rrweb scripts.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rrwebRecord from 'rrweb-v1/es/rrweb/packages/rrweb/src/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { getRecordConsolePlugin } from 'rrweb-v1/es/rrweb/packages/rrweb/src/plugins/console/record'

import { window } from './utils/globals'

if (window) {
    ;(window as any).rrweb = { record: rrwebRecord, version: 'v1', rrwebVersion: version }
    ;(window as any).rrwebConsoleRecord = { getRecordConsolePlugin }
}

export default rrwebRecord
