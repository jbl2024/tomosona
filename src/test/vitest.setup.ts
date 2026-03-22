type StorageLike = Pick<Storage, 'clear' | 'getItem' | 'key' | 'length' | 'removeItem' | 'setItem'>

function createStorage(): StorageLike {
  const data = new Map<string, string>()

  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key) ?? null : null
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    }
  }
}

const localStorageMock = createStorage()
const sessionStorageMock = createStorage()

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock
})

Object.defineProperty(window, 'sessionStorage', {
  configurable: true,
  value: sessionStorageMock
})

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock
})

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: sessionStorageMock
})
