import csp from 'js-csp'
import {spawnWorkers, cspAll, cspy} from './lib/csp_utils'
import {chunk} from 'lodash'
const rimraf = require('rimraf')
const path = require('path')

/* -- comment section --

TODO maybe save dependency tree / check before installing ? install only missing ?

-- end comment section -- */

const installer = spawnWorkers(5)

// installs resolved root node and all it's dependencies
// usually, when installing package dependencies, we don't 'install'
// the package itself - therefore skipRoot = true (set to false in some tests)
export function installTreeInto(rootNode, targetPath = './', skipRoot = true) {
  return csp.go(function*() {
    targetPath = path.resolve(targetPath) // convert to absolute
    let allNodes = rootNode.crawlAndFlatten()
    // up to 1024 packages passed to installer at once - limitation by csp library
    //for (let nodesChunk of chunk(allNodes, 1024)) {
      console.log(`Starting ${nodesChunk.length} pkgs <<<<<<<<<<<<<<<<<<<<<<<<`)
      yield cspAll(allNodes.map(node => installer(node.downloadAndInstall.bind(null, targetPath.replace(/\/+$/, '')))))
      console.log(`Done ${nodesChunk.length} pkgs <<<<<<<<<<<<<<<<<<<<<<<<<<<<<`)
    //}
    console.log('gonna link>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    // sequential linking - TODO test if accessing fs for symlinks benefits from parallelization
    for (let node of allNodes) {
      yield node.symlink(targetPath.replace(/\/+$/, ''))
    }
    yield cspy(rimraf, `${targetPath}/tmp_modules`) // delete downloaded archives
  })
}
