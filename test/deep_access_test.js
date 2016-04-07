import {expect} from 'chai'
import {getIn, setIn, updateIn} from '../src/lib/state_utils'

describe('Deep accessors', function() {

  function createState() {
    return {
      first: {
        second: {
          third: 47
        }
      },
      arr: [1, 2, {key: 'value'}]
    }
  }

  it('should forcepush data along nonexistent path', () => {
    let state = setIn({}, ['first', 'second', 'third'], 47, true)
    expect(state).to.deep.equal({first: {second: {third: 47}}})
  })

  it('should throw when setting data along nonexistent path without force', () => {
    let state = createState()
    expect(setIn.bind(null, state, ['first', 'fifth', 'second'], 47))
      .to.throw(/Can not find fifth in \[object Object\]/)
  })

  it('should set data along existing path', () => {
    let state = createState()
    let manualState = createState()
    manualState.arr[3] = 42
    manualState.first.second['fourth'] = 8
    state = setIn(state, ['first', 'second', 'fourth'], 8)
    state = setIn(state, ['arr', 3], 42)
    expect(state).to.deep.equal(manualState)
  })

  it('should update data by function', () => {
    let state = createState()
    let manualState = createState()
    manualState.arr[0] = manualState.arr[0] * 2
    state = updateIn(state, ['arr', 0], (x) => x * 2)
    expect(state).to.deep.equal(manualState)
  })

  it('should get data where they exist', () => {
    let state = createState()
    let a = []
    a[0] = getIn(state, ['first', 'second', 'third'])
    a[1] = getIn(state, ['arr', 2, 'key'])
    expect(a).to.deep.equal([47, 'value'])
  })

  it('should fail get when data does not exist', () => {
    let state = createState()
    expect(getIn.bind(null, state, ['arr', 2, 'nothing'])).to.throw(/Can not find nothing in \[object Object\]/)
  })

  it('should get default when it fails on last step', () => {
    let state = createState()
    let x = getIn(state, ['arr', 2, 'nothing'], {last: 8})
    expect(x).to.equal(8)
  })

  it('should get default when it fails on any step', () => {
    let state = createState()
    let x = getIn(state, ['arr', 8, 'nothing'], {any: 8})
    expect(x).to.equal(8)
  })

  it('should thow when path is not na array', () => {
    expect(getIn.bind(null, {}, {foo: 'bar'}))
      .to.throw(/Expected path to be non-empty array, got: \[object Object\]/)
  })

  it('should throw with invalid element in path', () => {
    expect(getIn.bind(null, {}, [12, {foo: 'bar'}]))
      .to.throw(/Path contains element that is not a number or a string. Path: 12,\[object Object\] Element: \[object Object\]/) // eslint-disable-line max-len
  })
})
