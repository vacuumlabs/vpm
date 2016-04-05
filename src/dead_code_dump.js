/*eslint-disable */
// all the code that's probably no longer usefull but might be of some value in the future

function mergeSubscribersSemver(subscribers) {
  return subscribers.reduce((merged, sub) => `${merged} ${sub.semver}`)
}

  function depSemverOverlap(depOne, depTwo) {
    return csp.go(function*() {
      if (depOne.name !== depTwo.name) return false
      if (depOne.resolvedIn === depTwo.resolvedIn) return true
      //if (semverCmp.cmp(previousIteration[name].semver,setTwo[name].semver)) return true
      const pkg = yield getter(depOne[name])
      return !!semver.maxSatisfying(Object.keys(pkg.versions, `${depOne.name.semver} ${depTwo.name.semver}`))
    })
  }