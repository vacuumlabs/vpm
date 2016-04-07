import csp from 'js-csp'
import {cloneDeep} from 'lodash'

// patch csp with a peek method: obtain a value from channel without removing it
csp.peek = function(ch) {
  return csp.go(function*() {
    console.log('before:')
    console.log(ch)
    let res = yield csp.take(ch)
    if (res === null) {
      console.log('RES IS NULL!!!???')
      console.log(res)
    }
    console.log('right after:')
    console.log(ch)
    yield csp.put(ch, res)
    console.log('after:')
    console.log(ch)
    return cloneDeep(res)
  })
}

export function cspAll(channels) {
  return csp.go(function*() {
    let res = yield csp.operations.into([], csp.operations.merge(channels))
    return res
  })
}

// returns a channel that blocks until function callback is called
// the channel yields either an error or csp.CLOSED
export function cspy(fn, ...args) {
  let ch = csp.chan()
  fn(...args, (err) => {
    if (err) csp.putAsync(ch, err)
    ch.close()
  })
  return ch
}
