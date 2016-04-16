import {satisfies, compare, validRange as semverValid} from 'semver'
import {random} from 'lodash'

const maxConflictDepth = 8
const minConflictDepth = 8
const conflicts = 8
const maxConflictsPerPkg = 8

const maxConflictChainLength = 3
const maxExtraConflictsEachStep = 3
// chance that new conflicting nodes are created on a separate branch instead of an existing
const spreadChance = 1

// major version reduced on each step on the chain + also on the first conflict
const maxMajorVer = maxConflictChainLength + 2
const maxMinorVer = 0
const maxPatchVer = 9

const maxSemver = `${maxMajorVer}.${maxMinorVer}.${maxPatchVer}`

function generatePackageVersion(name, version, dependencies = {}, peerDependencies = {}) {
  return `{
    "name":"${name}",
    "version":"${version}",
    "dependencies": ${JSON.stringify(dependencies)},
    "peerDependencies": ${JSON.stringify(peerDependencies)},
    "tarball":"https://github.com/vpmtest/empty/archive/master.tar.gz"
  }`
}

function dependencySet(semver='*') {
  return {
    semver: semver,
    private: [],
    public: []
  }
}

// iterate versions - major.minor.patch, 0 - max, try to match dependencySet
function generatePackage(name, depSets) {
  // sort by semver ascending - currently should be that way anyways, but just in case
  depSets.sort((a, b) => compare(a.semver, b.semver))
  let dsIt = 0
  let versions = {}
  for (let maj = 0; maj <= maxMajorVer; maj++) {
    for (let min = 0; min <= maxMinorVer; min++) {
      for (let patch = 0; patch <= maxPatchVer; patch++) {
        if (dsIt >= depSets.length) break
        let version = `${maj}.${min}.${patch}`
        if (satisfies(version, depSets[dsIt].semver)) {
          versions[version] = generatePackageVersion(name, version, depSets[dsIt].private, depSets[dsIt].public)
        } else {
          dsIt++
        }
      }
    }
  }
  return `{
    "name":"${name}",
    "versions":${JSON.stringify(versions)}
  }`
}

// receive a new pkg that will conflict as an argument (or create a new one by default)
// gen root, gen up to width other, place them all between confMinDepth and confMaxDepth
// gen new branches according to spreadChance
// continue single branch according to requiredChain, gen new requiredChain for other (if there are any)
function generateConflictingPubDepTree(confPkg, currentChain = 0, requiredChain = random(maxConflictChainLength)) {

}

// creates fake package.json at path, returns fake registry json
export function generateRegistryForPackageJson(path) {
}

// abstract representation of a package
function generateNode(name) {
  return {
    name: 'name',
    depSets: []
  }
}

function genDepSets(count) {

}

// creates a branch with leaf as the last node, with a way it to avoid iff avoidable === true
// maxSemver
function generateBranch(depth, root, leaf, branchMaxSemver, avoidable, leafDeps) {
  console.assert(!avoidable || depth > 1, 'Branch must be deeper than 1 to avoid dependency')
  let prev = root
  let first
  let branchName = Math.random().toString(36).substring(5)
  for (let i = 0; i < depth; i++) {
    let node = generateNode(`p${i}:${branchName}`)
    first = first || node
    // depth !== 0 since that would require extra thinking and we can't afford that at this time :)
    if ((avoidable) && (i === depth - 1 || Math.random() > i * 1.0 / depth)) {
      // random semver smaller then max
      let separator = randomLowerSemver(decSemver(branchMaxSemver))
      prev.depSets.push(dependencySet(randomLowerSemver(separator)))
      prev.depSets[0].private = generateNode(`avoid:${branchName}`)
      prev.depSets.push(dependencySet(randomHigherSemver(separator, branchMaxSemver)))
      prev.depSets[1].public = node
    } else {
      prev.depSets.push(dependencySet(randomLowerSemver(branchMaxSemver)))
      prev.depSets[0].public = node
    }
    prev = node
  }
  // add leaf, if avoidabe === false also an alternative
  if (avoidable) {
    // must be 'avoided' earlier, no fallback now
    prev.depSets.push(dependencySet(randomLowerSemver(branchMaxSemver)))
    prev.depSets[0].public = leaf
  } else {
    prev.depSets.push(leafDeps)
    // if 2 leafDeps, then use one as an avoid path (we're at the end of a chain)
    if (prev.depSets > 1) prev.depSets[0].private = generateNode(`direct-avoid:${branchName}`)
    prev.depSets[prev.depSets.length - 1].public = leaf
  }
}

// avoid param
function generateConflict(avoid) {
  //create root node to which we connect all other
  let rootName = Math.random().toString(10).substring(4)
  let root = generateNode(`root:${rootName}`)
  let conflict = generateNode(`conflict:${rootName}`)
  root.depSets.push(dependencySet())
  // branches - 1, the last one is special
  for (let i = 0; i < random(maxConflictChainLength) - 1; i++) {
    let leaf = generateNode(`leaf:${i+1}-${rootName}`)
    generateBranch(random(minConflictDepth, maxConflictDepth), root, leaf, branchMaxSemver, Math.random() > 0.5, leafDeps)
  }
  if (Math.random() > 0.5) {
    // create last as a separate branch
  } else {
    // create last on the same branch as previous
  }
  if (avoid) {
    // create a way to avoid whole subtree
    let ret = generateNode(`ext-root:${rootName}`)
    let separator = randomLowerSemver(decSemver(branchMaxSemver))
    ret.depSets.push(dependencySet(randomLowerSemver(separator)))
    ret.depSets[0].private = generateNode(`avoid-root:${rootName}`)
    ret.depSets.push(dependencySet(randomHigherSemver(separator, branchMaxSemver)))
    ret.depSets[1].private = root
    return ret
  }
  return root
}

// half closed interval
function randomLowerSemver(include) {
  let upperLimit = include
  let numLimit = upperLimit.split('.').map(x => parseInt(x))
  let lowerLimit = [random(0, numLimit[0]), random(0, numLimit[1]), random(0, numLimit[2])].join('.')
  return `${lowerLimit} - ${upperLimit}`
}

function randomHigherSemver(exclude, maxVer = maxSemver) {
  let [maxMajor, maxMinor, maxPatch] = maxVer.split('.')
  let lowerLimit = incSemver(exclude)
  let numLimit = lowerLimit.split('.').map(x => parseInt(x))
  let upperLimit = [random(numLimit[0], maxMajor), random(numLimit[1], maxMinor), random(numLimit[2], maxPatch)].join('.')
  return `${lowerLimit} - ${upperLimit}`
}

function decSemver(version) {
  let numVersion = version.split('.').map(x => parseInt(x))
  if (numVersion[2]) {
    numVersion[2]--
  } else if (numVersion[1]) {
    numVersion[1]--
    numVersion[2] = maxPatchVer
  } else if (numVersion[0]) {
    numVersion[0]--
    numVersion[1] = maxMinorVer
    numVersion[2] = maxPatchVer
  } else throw Error(`Can't decrease version ${version}`)
  return numVersion.join('.')
}

function incSemver(version) {
  let numVersion = version.split('.').map(x => parseInt(x))
  if (numVersion[2] < maxPatchVer) {
    numVersion[2]++
  } else if (numVersion[1] < maxMinorVer) {
    numVersion[1]++
    numVersion[2] = 0
  } else if (numVersion[0] < maxMajorVer) {
    numVersion[0]++
    numVersion[1] = 0
    numVersion[2] = 0
  } else throw Error(`Can't increase version ${version}`)
  return numVersion.join('.')
}

/* -- comment section --

TODO - MORE ON CONFLICTS

always 2 version groups (for now, TODO add more to confuse the annealing)
higher one conflicting
when chain - chain this until last nodes
on last node , decide - resolvable directly, below, outside

the base conflicting node fixed, groups for other

TODO two types of chain conflicts - one way, two way
two way always on last step, resolvable only below / outside

-- end comment section -- */
