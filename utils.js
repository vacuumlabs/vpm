'use strict';

Object.entries = function* entries(obj) {
   for (let key of Object.keys(obj)) {
     yield [key, obj[key]]
   }
}

Object.toArray = (obj) => {
  let arr = []
  for (let key of Object.keys(obj)) {
     arr.push([key, obj[key]])
  }
  return arr
}

Map.fromObject = (obj) => {
  return new Map(Object.entries(obj))
}

function dummyError(e) {
  if (e) 
    console.log(e)
  else
    console.log('TODO error handling')
}

module.exports = {
  dummyError: dummyError
}