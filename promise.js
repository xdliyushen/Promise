function Promise(fn) {
    if (typeof fn !== 'function') {
        throw new TypeError(`Promise resolver ${fn} is not a function`)
    }

    this.status = 'pending';
    this.value = null;

    this._onResolvedFns = [];
    this._onRejectedFns = [];
    this._promiseList = [];

    function _clearFnQueue(queue, promiseList) {
        let executor = null;
        let currentPromise = null;

        while (queue.length > 0) {
            executor = queue.shift();
            currentPromise = promiseList.shift();

            // executor 为函数
            if (typeof executor === 'function') {
                let value = null;
                try {
                    value = executor();
                } catch (err) {
                    currentPromise.status = 'rejected';
                    currentPromise.value = err;
                    // 如果执行出错, 影响的应该是后面 then 的执行, 而不是数组中其他 fn 的执行
                    // 肯定是得广度优先执行, 队列中的函数应提前绑定好 this 以及 value 值
                    // 执行错误的时候, 绑定的应该是下级中的 onRejectedFns
                    while (currentPromise._promiseList.length > 0) {
                        let nextPromise = currentPromise._promiseList.shift();
                        let nextRejectedFns = currentPromise._onRejectedFns;

                        // 将下一层 then 调用所需的 Promise 放入 promiseList 中
                        promiseList.push(nextPromise);

                        while (nextRejectedFns.length > 0) {
                            let fn = nextRejectedFns.shift();
                            queue.push(fn.bind(currentPromise, currentPromise.value));
                        }
                    }
                }

                currentPromise.status = 'resolved';
                currentPromise.value = value;

                // 肯定是得广度优先执行, 队列中的函数应提前绑定好 this 以及 value 值
                while (currentPromise._promiseList.length > 0) {
                    let nextPromise = currentPromise._promiseList.shift();
                    let nextResolvedFns = currentPromise._onResolvedFns;

                    // 将下一层 then 调用所需的 Promise 放入 promiseList 中
                    promiseList.push(nextPromise);

                    while (nextResolvedFns.length > 0) {
                        let fn = nextResolvedFns.shift();
                        queue.push(fn.bind(currentPromise, currentPromise.value));
                    }
                }
            } else {
                continue;
            }
        }
    }

    function resolve(value) {
        this.status = 'resolved';
        this.value = value;
        let context = window || undefined;

        // 将 onResolvedFns 队列中的函数绑定上 this 对象以及传入的 value 值
        for (let i = 0; i < this._onResolvedFns.length; i++) {
            let fn = this._onResolvedFns[i];
            this._onResolvedFns[i] = fn.bind(context, value);
        }

        _clearFnQueue.call(this, this._onResolvedFns, this._promiseList);
    }

    function reject(err) {
        this.status = 'rejected';
        this.value = err;
        let context = window || undefined;

        // 将 onRejectedFns 队列中的函数绑定上 this 对象以及传入的 value 值
        for (let i = 0; i < this._onRejectedFns.length; i++) {
            let fn = this._onRejectedFns[i];
            this._onRejectedFns[i] = fn.bind(context, err);
        }

        _clearFnQueue.call(this, this._onRejectedFns, this._promiseList);
    }

    try {
        fn(resolve.bind(this), reject.bind(this));
    } catch (err) {
        throw (err);
    }
}

// 返回新对象, 新对象状态根据之前 Promise 执行的结果来进行判断
Promise.prototype.then = function (onFulfilled, onRejected) {
    if (onFulfilled === undefined) {
        onFulfilled = val => val;
    }
    if (onRejected === undefined) {
        onRejected = err => err;
    }

    // 用于保存要执行的函数
    let executor = null;

    if (this.status === 'pending') {
        this._onResolvedFns.push(onFulfilled);
        this._onRejectedFns.push(onRejected);
        // 返回新的 Promise 对象, 挂载在 _promiseList 上
        let nextPromise = new Promise(() => { })
        this._promiseList.push(nextPromise);
        return nextPromise;
    } else if (this.status === 'resolved') {
        // 如果前面的 Promise 状态为 resolved, 且 onFulfilled 不为函数, 则应该返回和前面 Promise 值一样的新 Promise
        if (typeof onFulfilled !== 'function') {
            return Promise.resolve(this.value);
        }

        executor = onFulfilled;
    } else if (this.status === 'rejected') {
        // 如果前面的 Promise 状态为 rejected, 且 onRejected 不为函数, 则应该返回和前面 Promise 错误原因一样的新 Promise
        if (typeof onRejected !== 'function') {
            return Promise.reject(this.value);
        }

        executor = onRejected;
    }

    try {
        let result = executor(this.value);
        return Promise.resolve(result);
    } catch (err) {
        return Promise.reject(err);
    }
}

Promise.all = function (arr) {
    if (typeof arr[Symbol.iterator] !== 'function') {
        throw new TypeError(`${arr} is not iterable (cannot read property Symbol(Symbol.iterator))`)
    }

    let p = new Promise(() => { });
    // 剩余任务的数量
    let count = 0;
    let onResolved = function (val) {
        if (p.status === 'pending') {
            count--;
        }
        if (count === 0) {
            p.status = 'resolved';
            p.value = arr;
        }
    }
    let onRejected = function (val) {
        if (p.status !== 'rejected') {
            p.status = 'rejected';
            p.value = val;
        }
    }

    // 数组中元素是 Promise 对象时, 才添加 then 方法
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] instanceof Promise) {
            count++;
            arr[i].then(onResolved, onRejected);
        }
    }

    if (count === 0) {
        return Promise.resolve(arr);
    } else {
        return p;
    }
}

Promise.race = function (arr) {
    if (typeof arr[Symbol.iterator] !== 'function') {
        throw new TypeError(`${arr} is not iterable (cannot read property Symbol(Symbol.iterator))`)
    }

    let p = new Promise(() => { });
    let onResolved = function (val) {
        if (p.status === 'pending') {
            p.status = 'resolved';
            p.value = val;
        }
    }
    let onRejected = function (val) {
        if (p.status === 'pending') {
            p.status = 'rejected';
            p.value = val;
        }
    }

    // 数组中元素是 Promise 对象时, 才添加 then 方法
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] instanceof Promise) {
            arr[i].then(onResolved, onRejected);
        }
    }

    return p;
}

Promise.resolve = function (value) {
    // 参数是 Promise 对象, 直接返回参数即可
    if (value instanceof Promise) {
        return value;
    }

    // 参数为 thenable 对象
    if (typeof value === 'Object' && value.then) {
        // then 为一个方法
        if (typeof value.then === 'function') {
            return new Promise(value.then);
        } else {
            // then 为一个属性
            return new Promise((resolve, reject) => {
                resolve(value.then);
            });
        }
    }

    return new Promise((resolve, reject) => {
        resolve(value);
    });
}

// 相比之下, reject的逻辑就简单很多, 无论传入的东西是什么, 统一作为错误原因返回就行了
Promise.reject = function (err) {
    return new Promise((resolve, reject) => {
        reject(err);
    })
}

// test1
console.log(1);
let p = new Promise((resolve, reject) => {
    setTimeout(() => {
        resolve(4);
    })
})

console.log(2);

p.then((val) => {
    console.log(val);
    return val + 1;
}).then((val) => {
    console.log(val);
    return 5;
})

console.log(3);

// test2
let p = new Promise((resolve, reject) => {
    setTimeout(() => {
        resolve(1);
    }, 1000)
});
let x = p.then(val => val + 1);
let y = p.then(val => val + 1);

// test3
let p = new Promise((resolve, reject) => {
    setTimeout(() => {
        resolve(1);
    }, 1000)
});
let x = p.then(val => {
    console.log('x1: ' + (val + 1));
    return (val + 1);
}).then(val => {
    console.log('x2: ' + (val + 1));
    return (val + 1);
});
let y = p.then(val => {
    console.log('y1: ' + (val + 1));
    return (val + 1);
});

// test 4
let p = new Promise((resolve, reject) => {
    setTimeout(() => {
        resolve(1);
    }, 1000)
});
let x = p.then();

// test 5
let rejectTimer = new Promise((resolve, reject) => {
    setTimeout(() => {
        reject(1);
    }, 1000);
})
let resolveTimer = new Promise((resolve, reject) => {
    setTimeout(() => {
        resolve(1);
    }, 1000);
})
let resolveP = Promise.resolve(2);
let rejectP = Promise.reject(2);
let arr1 = [resolveP, rejectP];
let arr2 = [rejectTimer, resolveP];
let arr3 = [resolveP, 444];
let arr4 = [resolveTimer, resolveP];

let asyncRejectedP = Promise.all(arr2);
let asyncResolvedP = Promise.all(arr4);

console.log(Promise.all(arr1));
console.log(asyncRejectedP);
console.log(Promise.all(arr3));
console.log(asyncResolvedP);
console.log(Promise.all([]));
console.log(Promise.all());			