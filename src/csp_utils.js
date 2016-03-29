import http from 'http'
import csp from 'js-csp'
import {isEqual} from 'lodash'

// TODO: is this needed anymore?
// limit to help prevent ECONNREFUSED
// http.globalAgent.maxSockets = 20


// patch csp with a peek method: obtain a value from channel without removing it
csp.peek = function(ch) {
  return csp.go(function*() {
    let res = yield csp.take(ch)
    yield csp.put(ch, res)
    return res
  })
}

// generic GET which returns csp-channel
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
  // otherwise print and ignore
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

// returns channel containg info about single package
export function _getPackageInfo(pkg) {
  let versionGroups = undefined
  let directPubs = undefined
  const packageFunctions = {
    getVersionGroups = () => {
      if (versionGroups !== undefined) return versionGroups
      //TODO CONTINUE HERE!
      return versionGroups
    },
    getDirectPubs = () => {
      if (directPubs !== undefined) return directPubs
      // TODO
      return directPubs
    },
    getVerionUrl = (verion) => {
      // TODO
    }
  }
  return csp.go(function*() {
    let options = {
      host: 'registry.npmjs.org',
      path: `/${pkg}`
    }
    return Object.assign(
      Object.create(packageFunctions),
      JSON.parse(yield csp.take(cspHttpGet(options)))
    )
  })
}

/** returns `pkgInfoGetter`, `pkgInfoGetter(pkg)` retrieves info about a single pkg, internally uses
 * `nrConnections` number of workers and will use `registry` as its cache
**/

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

  // pkfInfoGetter
  return (pkg) => {
    return csp.go(function*() {
      if (pkg in registry) {
        if ('package' in registry[pkg]) {
          return yield csp.peek(registry[pkg])
        }
      }
      // resChan has to have buffer of a size 1 to be peek-able
      let resChan = csp.chan(1)
      registry[pkg] = resChan
      yield csp.put(ch, [pkg, resChan])
      return yield csp.peek(resChan)
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
