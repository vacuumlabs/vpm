import {
  has,
  clone
} from 'lodash'

// path is an array accessed in order - i.e. for state.user.posts[8] path would be = ['user', 'posts', 8]

// in setIn/updateIn force=true creates empty objects where path does not exist

// in geIn last argument is a map of default fallbacks
// last is used when access fails at last step
// any is used when access fails at any step

export function getIn(state, path, fallbacks = {}) {
  checkValidPath(path)
  let value = state
  for (let i = 0; i < path.length; i++) {
    if (has(value, path[i])) {
      value = value[path[i]]
    } else {
      if (i === path.length - 1 && has(fallbacks, 'last')) {
        return fallbacks['last']
      } else if (has(fallbacks, 'any')) {
        return fallbacks['any']
      } else {
        throwError('getIn', state, path.slice(0, i + 1), value)
      }
    }
  }
  return value
}

export function updateIn(state, path, fn, force = false) {
  checkValidPath(path, 1)
  return recursiveUpdate('updateIn', state, state, path, 0, fn, force)
}

export function setIn(state, path, val, force = false) {
  checkValidPath(path, 1)
  return recursiveUpdate('setIn', state, state, path, 0, () => val, force)
}

// taskName and whole state and path for debugging purposes
function recursiveUpdate(taskName, state, resolvedState, path, index, fn, force = false) {
  // (shallow) clone from lodash, on which we edit/descend down the desired attribute
  let shallowCopy = clone(resolvedState)
  if (path.length - 1 === index) {
    shallowCopy[path[index]] = fn(has(shallowCopy, path[index]) ? shallowCopy[path[index]] : undefined)
  } else {
    if (!has(shallowCopy, path[index])) {
      if (force) {
        shallowCopy[path[index]] = {}
      } else {
        throwError(taskName, state, path.slice(0, index + 1), shallowCopy)
      }
    }
    shallowCopy[path[index]] = recursiveUpdate(taskName, state,
      shallowCopy[path[index]], path, index + 1, fn, force)
  }
  return shallowCopy
}

function checkValidPath(path, minLength = 0) {
  if (!(path instanceof Array) || path.length < minLength) {
    throw new Error(`Expected path to be non-empty array, got: ${path}`)
  }
  // path may consist only of numbers and strings
  for (let e of path) {
    if (!((typeof e === 'string') || (typeof e === 'number'))) {
      throw new TypeError(`Path contains element that is not a number or a string. Path: ${path} Element: ${e}`)
    }
  }
}

function throwError(taskName, state, pathSegment, value) {
  console.error(`${taskName} failed - can not find
    ${pathSegment[pathSegment.length - 1]} in ${value}`) // eslint-disable-line no-console
  console.error('State: ', state) // eslint-disable-line no-console
  console.error('Path (until failure): ', pathSegment) // eslint-disable-line no-console
  throw new Error(`Can not find ${pathSegment[pathSegment.length - 1]} in ${value}`)
}
