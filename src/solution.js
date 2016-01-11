// everything related to constructing solution here
import csp from 'js-csp'
import t from 'transducers.js'
import cspu from './csp_utils.js'
import semver from 'semver'
import Queue from 'fastqueue'

// transducers
const extractKeys = t.map(kv => kv[0])

function maxVersion(pkg) {
  return semver.maxSatisfying(t.toArray(registry[pkg[0]], extractKeys), pkg[1])
}

//returns "package-name@max-sat-version"
function maxVersionSolutionKey(pkg) {
  return `${pkg[0]}@${maxVersion(pkg)}`
}

// the temporal dumb resolver, keeps on installing highest possible versions until it satisfies all dependencies
export function getSolution(dependencies,registry) {
  let solution = {}
  const queue = new Queue
  solution['root']= t.toArray(coll, t.map(e => maxVersionSolutionKey(e)))
  solution['root'].forEach( e => queue.push(e))
  while (queue.length > 0) {
    let pkg = queue.shift()
    let solutionKey = maxVersionSolutionKey(pkg)
    if (solutionKey in solution) continue
    let version = maxVersion(pkg)
    let deps = []
    for dep in registry[pkg[0]][version].dependencies {
      let depKey = maxVersionSolutionKey(dep)
      deps.push(depKey)
      queue.push(depKey)
    }
    solution[solutionKey] = deps
  }
  return solution
}