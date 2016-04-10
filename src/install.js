import {mkdirp} from 'mkdirp'
import tarball from 'tarball-extract'
import csp from 'js-csp'
import {map, filter, seq} from 'transducers.js'
import {spawnWorkers, cspAll} from './csp_utils'
import {rimraf} from 'rimraf'

/* -- comment section --

TODO flatten package tree
TODO download all flattened
TODO install all downloaded
TODO parallel down/inst ? check node registry

-- end comment section -- */

const installer = spawnWorkers(5)

// at this point, nodes should store their relative install path
function symlinkRecurse(node, rootPath, token = Symbol()) {
  // TODO
}

// installs resolved root node and all it's dependencies
export function install(rootNode, targetPath = './') {
  return csp.go(function*() {
    let allNodes = rootNode.crawlAndFlatten()
    yield cspAll(allNodes.map(node => installer(node.downloadAndInstall.bind(null, targetPath.replace(/\/+$/, '')))))
    symlinkRecurse(rootNode, `${targetPath.replace(/\/+$/, '')}/node_modules`)
  })
}
