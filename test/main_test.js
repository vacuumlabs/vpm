import {expect} from 'chai'
import 'co-mocha'
import {install} from '../src/main.js'
import {resolveRootNode, mutateIntoConsistent} from '../src/node_registry.js'
import csp from 'js-csp'
import {cspy} from '../src/lib/csp_utils'
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const fs = require('fs')

describe('Main', function() {
  this.timeout(1024000)

  const targetPath = './_test/main'

  beforeEach((done) => {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield cspy(mkdirp, targetPath)
      fs.createReadStream('package.json').pipe(fs.createWriteStream(`${targetPath}/package.json`));
    }), () => done())
  })

  it('should do stuff', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield install(targetPath)
    }), () => done())
  })


})
