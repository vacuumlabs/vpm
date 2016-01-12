import http from 'http'
import csp from 'js-csp'
//import {map} from 'transducers.js'
//import t from 'transducers.js'

//const filterKeysForRegistry = t.filter(kv => /^tarball$|^dependencies$/.test(kv[0]))
//const transduceValue = (transducer) => t.map(kv => [kv[0], t.seq(kv[1], transducer)])

// limit to help prevent ECONNREFUSED
http.globalAgent.maxSockets = 20

csp.peek = function(ch) {
  return csp.go(function*() {
    let res = yield csp.take(ch)
    yield csp.put(ch, res)
    return res
  })
}

// generic GET which returns csp-channel (wiht optional transducer)
// TODO: rewrite this in a more simple form:
//   while (not success) {
//     yield try-http-request
//   }
//   return result
export function cspHttpGet(options) {
  let reschan = csp.chan(1)

  function processResponse(response) {
    let str = []
    //another chunk of data has been recieved, so append it to `str`
    response.on('data', function(chunk) {
      str.push(chunk)
    })
    //the whole response has been recieved, so we just print it out here
    response.on('end', function() {
      csp.putAsync(reschan, str.join(''))
      reschan.close()
      return reschan
    })
  }

  // for now just redo the request on connection refuse,
  // otherwise print and ignore (TODO better error handling)
  function requestAndHandleErrors(options, callback) {
    http.request(options, callback).on('error', function(err) {
      console.log('http error')
      console.log(err)
      if (err.code === 'ECONNREFUSED') {
        console.log('Connection to registry refused, re-trying (Ctr+C to stop...)')
        requestAndHandleErrors(options, callback)
      }
    }).end()
  }

  requestAndHandleErrors(options, processResponse)
  return reschan
}

export function _getPackageInfo(pkg) {
  return csp.go(function*() {
    let options = {
      host: 'registry.npmjs.org',
      path: `/${pkg}`
    }
    //return cspHttpGet(options, map((str) => JSON.parse(str)))
    return JSON.parse(yield csp.take(cspHttpGet(options)))
  })
}

export function getPackageInfo(registry, nrConnections) {
  let ch = csp.chan()

  function* spawnWorker() {
    while (true) {
      let [pkg, resChan] = yield csp.take(ch)
      let res = yield csp.take(_getPackageInfo(pkg))
      yield csp.put(resChan, res)
    }
  }

  for (let i = 0; i < nrConnections; i++) {
    csp.go(spawnWorker)
  }

  // second arg is just for debugging purposes
  // getter
  return (pkg, main) => {
    return csp.go(function*() {
      if (pkg in registry) {
        if ('package' in registry[pkg]) {
          return registry[pkg].package
        } else {
          return yield csp.peek(registry[pkg].channel)
        }
      }
      let resChan = csp.chan(1)
      registry[pkg] = {channel: resChan}
      yield csp.put(ch, [pkg, resChan])
      let res = yield csp.peek(resChan)
      registry[pkg].package = res
      return res
    })
  }
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
