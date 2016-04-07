import {expect} from 'chai'
import 'co-mocha'
import {getPackageInfo, cspHttpGet} from '../src/pkg_registry.js'
import csp from 'js-csp'

describe('Package registry', function() {

  const getter = getPackageInfo()

  it('should retrieve package from the internet', function*() {
    /*
    //WTF SERIOUSLY
    let pkg='babel-core'
    let options = {
      host: 'registry.npmjs.org',
      path: `/${pkg}`
    }
    let g = getter('babel-core')
    console.log('gyiasgodiaysgdyoasgfduyasg')
    console.log(yield csp.take(cspHttpGet(options)))
    //let a = yield csp.take(getter('babel-core'))
    //let b = JSON.parse()
    //expect(a).to.deep.equal(b)
    */
  })

})
