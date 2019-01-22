import React, { Component } from 'react';
import PropTypes from 'prop-types';
/*组件内部直接取 context 的问题：
  1、有大量重复的逻辑：
     它们基本的逻辑都是，取出 context，取出里面的 store，然后用里面的状态设置自己的状态，这些代码逻辑其实都是相同的。
  2、对 context 依赖性过强：
     这些组件都要依赖 context 来取数据，使得这个组件复用性基本为零。想一下，
     如果别人需要用到里面的 ThemeSwitch 组件，但是他们的组件树并没有 context 也没有 store，他们没法用这个组件了。
*/


/*connect 是一个函数
  1、每个传进去的组件需要 store 里面的数据都不一样的，
     所以除了给高阶组件传入 Dumb 组件以外，还需要告诉高级组件我们需要什么数据，高阶组件才能正确地去取数据

  2、connect 现在是接受一个参数 mapStateToProps，然后返回一个函数，这个返回的函数才是高阶组件
*/
export const connect = (mapStateToProps) => (WrappedComponent) => {
  class Connect extends Component {
    static contextTypes = {
      store: PropTypes.object
    }

    render () {
      const { store } = this.context;
      /*这里的 store.getState() 才是实际参数*/
      let stateProps = mapStateToProps(store.getState());
      return <WrappedComponent {...stateProps} />
    }
  }

  return Connect;
}
