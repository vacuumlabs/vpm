'use strict';

const flattenArray = (array) => {
  return [].concat.apply([], array)
}

const toArray = (obj) => {
  let arr = []
  if (!obj) return arr
  if (Array.isArray(obj)) return obj
  // TODO check for maps?!
  // let it throw error if non-falsy non-object is passed in
  for (let key of Object.keys(obj)) {
     arr.push([key, obj[key]])
  }
  return arr
}

const toMap = (obj) => {
  // TODO check for maps?!
  if (Array.isArray(obj)) return new Map(obj)
  return new Map(toArray(obj))
}

const dummyError = (e) => {
  if (e) 
    console.log(e)
  else
    console.log('TODO error handling')
}

module.exports = {
  dummyError: dummyError,
  toArray: toArray,
  toMap: toMap,
  flattenArray: flattenArray
}
