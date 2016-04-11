import csp from 'js-csp'
import {spawnWorkers, cspAll, cspy} from './lib/csp_utils'
const rimraf = require('rimraf')
const path = require('path')

/* -- comment section --

TODO maybe save dependency tree / check before installing ? install only missing ?

-- end comment section -- */

const installer = spawnWorkers(5)

// installs resolved root node and all it's dependencies
export function installTreeInto(rootNode, targetPath = './') {
  return csp.go(function*() {
    targetPath = path.resolve(targetPath) // convert to absolute
    let allNodes = rootNode.crawlAndFlatten()
    yield cspAll(allNodes.map(node => installer(node.downloadAndInstall.bind(null, targetPath.replace(/\/+$/, '')))))
    // sequential linking - TODO test if accessing fs for symlinks benefits from parallelization
    for (let node of allNodes) {
      yield node.symlink(targetPath.replace(/\/+$/, ''))
    }
    yield cspy(rimraf, `${targetPath}/tmp_modules`) // delete downloaded archives
  })
}
