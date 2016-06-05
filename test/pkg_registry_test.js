import {expect} from 'chai'
import 'co-mocha'
import {getPackageInfo, _getPackageInfo} from '../src/pkg_registry.js'
import csp from 'js-csp'

describe('Package registry', function() {
  this.timeout(32000)

  const getter = getPackageInfo()

  it('should peek', function(done) {
    let c = csp.chan(1)
    expect(csp.offer(c, 'foobar')).to.equal(true)
    csp.takeAsync(csp.go(function*() {
      for (let i = 0; i < 20; i++) {
        yield csp.peek(c)
      }
    }), () => done())
  })

  it('should store a peekable package', function(done) {
    csp.takeAsync(csp.go(function*() {
      let c = csp.chan(1)
      csp.operations.pipe(_getPackageInfo('babel-core'), c, true)
      for (let i = 0; i < 20; i++) {
        yield csp.peek(c)
      }
    }), () => done())
  })

  it('should get the same package repeatedly', function(done) {
    csp.takeAsync(csp.go(function*() {
      let getPkg = getter.bind(null, 'babel-core')
      for (let i = 0; i < 20; i++) {
        yield getPkg()
      }
    }), () => done())
  })

})
