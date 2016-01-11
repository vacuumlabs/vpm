import http from 'http'
import csp from 'js-csp'
import {map} from 'transducers.js'

// limit to help prevent ECONNREFUSED
http.globalAgent.maxSockets = 5

// generic GET which returns csp-channel (wiht optional transducer)
export function cspHttpGet(options, transducer = undefined) {
  let reschan = csp.chan(1, transducer)

  function processResponse(response) {
    let str = ''
    //another chunk of data has been recieved, so append it to `str`
    response.on('data', function(chunk) {
      str += chunk
    })
    //the whole response has been recieved, so we just print it out here
    response.on('end', function() {
      csp.putAsync(reschan, str)
      reschan.close()
      return reschan
    })
  }

  // for now just redo the request on connection refuse,
  // otherwise print and ignore (TODO better error handling)
  function requestAndHandleErrors(options, callback) {
    http.request(options, callback).on('error', function(err) {
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

export function getPackageInfo(pkg) {
  let options = {
    host: 'registry.npmjs.org',
    path: `/${pkg}`
  }
  return cspHttpGet(options, map((str) => JSON.parse(str)))
}

export

export function cspAll(channels) {
  return csp.go(function*() {
    let res = yield csp.operations.into([], csp.operations.merge(channels))
    return res
  })
}

// returns a channel that blocks until function callback is called
// the channel yields either an error or csp.CLOSED
export function cspy(function, ...args) {
  let ch = csp.chan()
  function(...args, (err) => {
    if (err) cps.putAsync(ch, err)
    ch.close()
  })
  return ch
}