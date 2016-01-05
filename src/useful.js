import {fromJS, Iterable} from 'immutable'
import {assert} from 'chai'
import {Promise} from 'bluebird'

export function promisify(callback: Function) {
  return new Promise((resolve, reject) => {
    // On failure, the first argument will be an Error object indicating the
    // failure, with a machine-readable code attribute. On success, the first
    // argument will be null and the second can be an object containing result.
    callback((error, data) => {
      if (error) {
        reject(error)
        return
      }
      resolve(data)
    })
  })
}

export function normalizeEmail(email) {
  return email.toLowerCase().replace(/[\.\$\#\[\]\,\ ]/g, '_')
}

export function jsify(obj) {
  if (obj == null) {
    return null
  } else if (typeof obj === 'object') {
    return fromJS(obj).toJS()
  } else {
    return obj
  }
}

export function isEmpty(obj) {
  return Object.keys(obj).length === 0
}

export function forEachKV(obj, fn) {
  Object.keys(obj).forEach((key) => fn(key, obj[key]))
}

export function toArr(obj) {
  let result = []
  forEachKV(obj, (key, val) => result.push([key, val]))
  return result
}

export function sum(arr) {
  return arr.reduce((x, y) => x + y, 0)
}

export function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n)
}

export function all(iterable, fn) {
  for (let elem of iterable) {
    if (!fn(elem)) {
      return false
    }
  }
  return true
}

export function any(iterable, fn) {
  for (let elem of iterable) {
    if (fn(elem)) {
      return true
    }
  }
  return false
}

export function stringContains(where, what) {
  return where.indexOf(what) > -1
}

export function isIterable(obj) {
  // checks for null and undefined
  if (obj == null) {
    return false
  }
  return obj[Symbol.iterator] !== undefined
}

export function extend(array, elems) {
  return Array.prototype.push.apply(array, Array.from(elems))
}

export function flattenShallow(iterable) {
  return flatmap(iterable, (_) => _)
}

export function flatmap(iterable, fn) {
  let res = []
  for (let elem of iterable) {
    let toAppend = fn(elem)
    if (isIterable(toAppend)) {
      extend(res, toAppend)
    } else {
      throw new Error(`flatmap values must be iterables, got ${toAppend}`)
    }
  }
  return res
}

export function randomIndex(list) {
  return Math.floor(Math.random() * (Iterable.isIterable(list) ? list.count() : list.length))
}

export function randomChoice(list) {
  return Iterable.isIterable(list) ? list.get(randomIndex(list)) : list[randomIndex(list)]
}

// Returns a list of random distinct numbers up to `upto`, exclusive
export function randomDistinctNumbers(upto, amount) {
  const numbers = Array.apply(null, new Array(upto)).map((x, i) => i)
  const chosen = []
  repeat(Math.min(amount, upto), (i) => {
    // Push and delete a random index from numbers (splice returns list of deleted elements)
    chosen.push(numbers.splice(randomIndex(numbers), 1)[0])
  })
  return chosen
}

// Returns a list of distinct, randomly chosen elements
export function randomDistinctChoices(list, amount) {

  const length = Iterable.isIterable(list) ? list.count() : list.length

  // Create random distinct numbers
  const indexes = randomDistinctNumbers(length, Math.min(length, amount))

  return indexes.map((ind) => Iterable.isIterable(list) ? list.get(ind) : list[ind])
}

export function repeatAsync(n, f) {
  let res = Promise.resolve()
  repeat(n, (i) => {
    res = res.then((_) => f(i))
  })
  return res
}

export function repeat(num, fn) {
  for (let i = 0; i < num; i++) {
    fn(i)
  }
}

(() => {
  assert.equal(isIterable([1, 2, 3]), true)
  assert.equal(isIterable(fromJS([1, 2, 3])), true)
  assert.equal(isIterable(fromJS({a: 'b'})), true)
  assert.equal(isIterable('ahoj'), true)
  assert.equal(isIterable(true), false)
  assert.equal(isIterable({a: 'b'}), false)
  assert.equal(isIterable(null), false)
  assert.equal(isIterable(undefined), false)
})();

(() => {
  let arr = [1, 2]
  extend(arr, [3, 4])
  assert.deepEqual(arr, [1, 2, 3, 4])
  arr = [1, 2]
  // does it work with iterable other than Array?
  extend(arr, fromJS([3, 4]))
  assert.deepEqual(arr, [1, 2, 3, 4])
})()
