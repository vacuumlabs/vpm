import {installTreeInto} from './install.js'
import {resolveRootNode, mutateIntoConsistent} from './node_registry.js'
import csp from 'js-csp'

export function install(rootPath) {
  return csp.go(function*() {
    let root = yield resolveRootNode(rootPath)
    yield mutateIntoConsistent(root)
    yield installTreeInto(root, rootPath)
    root.crawlAndPrint()
  })
}
