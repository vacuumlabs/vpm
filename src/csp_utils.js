import http from 'http'
import csp from 'js-csp'

export function getPackageInfo(pkg) {

  let options = {
    host: 'registry.npmjs.org',
    path: `/${pkg}`
  }

  let reschan = csp.chan()

  function processResponse(response) {

    let str = ''

    //another chunk of data has been recieved, so append it to `str`
    response.on('data', function(chunk) {
      str += chunk
    })

    //the whole response has been recieved, so we just print it out here
    response.on('end', function() {
      csp.putAsync(reschan, JSON.parse(str))
      reschan.close()
      return reschan
    })
  }

  http.request(options, processResponse).end()
  return reschan
}

export function cspAll(channels) {
  return csp.go(function*() {
    let res = yield csp.operations.into([], csp.operations.merge(channels))
    return res
  })
}
