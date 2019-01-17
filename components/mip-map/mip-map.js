import './mip-map.less'

const { CustomElement, util, viewer, sandbox } = MIP
const log = util.log('mip-map')

/**
 * 工具方法 拼接键值对
 *
 * @param {Object} obj 需要处理的对象
 * @returns {string} 拼接字符串
 */
function traverseAndConcat (obj) {
  let output = ''
  Object.keys(obj).forEach(key => {
    let val = obj[key]
    if (val) {
      output += val
    }
  })
  return output
}

export default class MIPMap extends CustomElement {
  constructor (...args) {
    super(...args)
    let el = this.element
    let config = {}

    try {
      config = util.jsonParse(el.querySelector('script[type="application/json"]').textContent)
    } catch (e) {
      log.warn(e)
    }

    this.ak = config.ak || ''
    this.location = config.location
    this.controls = config.controls
    this.info = config.info
    this.getPosition = config['get-position'] === true
    this.dataOnlyGetSdk = config['data-only-get-sdk'] === true

    this.map = null
    this.point = {}
    this.marker = null
    this.currentMarker = null
  }

  /**
   * 仅加载sdk
   *
   */
  loadSdk () {
    let BMap = window.BMap

    // BMap注入沙盒
    Object.defineProperty(sandbox, 'BMap', {
      value: BMap,
      writable: false,
      enumerable: true,
      configurable: true
    })

    // 派发事件
    viewer.eventAction.execute('loaded', this.element, {})
  }

  /**
   * 自动定位
   *
   */
  getCurrentLocation () {
    let BMap = window.BMap
    let geolocation = new BMap.Geolocation()
    geolocation.getCurrentPosition(res => {
      // 无定位权限
      if (!res.accuracy) {
        return viewer.eventAction.execute('getPositionFailed', this.element, res)
      } else if (geolocation.getStatus() === window.BMAP_STATUS_SUCCESS) {
        this.currentMarker = new BMap.Marker(res.point)
        this.map.addOverlay(this.currentMarker)
        this.map.panTo(res.point)

        // 派发事件
        viewer.eventAction.execute('getPositionComplete', this.element, res)
      }
    }, {enableHighAccuracy: true})
  }

  /**
   * 定位至local配置的位置
   *
   */
  searchLocation () {
    let BMap = window.BMap

    // 配置地址
    let address = traverseAndConcat(this.location)

    // 没有定位信息，则使用自动定位
    if (!address || !this.location.city) {
      this.getCurrentLocation()
      viewer.eventAction.execute('searchLocalFailed', this.element, {})
      return
    }
    let options = {
      onSearchComplete: results => {
        if (local.getStatus() !== window.BMAP_STATUS_SUCCESS) {
          return
        }
        let firstResult = results.getPoi(0)
        this.point = firstResult.point
        if (!firstResult || !this.point) {
          return
        }
        this.marker = new BMap.Marker(this.point)
        this.map.addOverlay(this.marker)
        this.map.centerAndZoom(this.point, 16)

        // 配置弹层
        this.setInfoWindow()
      }
    }

    // 搜索并定位地址
    let local = new BMap.LocalSearch(this.map, options)
    local.search(address)
  }

  /**
   * 配置弹层信息
   *
   */
  setInfoWindow () {
    let BMap = window.BMap
    if (!this.info) {
      return
    }
    let infoWindow = new BMap.InfoWindow(this.info.content, this.info)
    this.marker.addEventListener('click', () => {
      this.map.openInfoWindow(infoWindow, this.point)
    })
  }

  /**
   * 配置地图控件
   *
   */
  addControls () {
    let BMap = window.BMap
    let controls = this.controls

    Object.keys(controls).forEach(key => {
      let params = controls[key] || {}

      // 识别 BMAP_* 常量
      Object.keys(params).forEach(prop => {
        let val = params[prop]
        if (typeof val === 'string' && val.indexOf('BMAP_') !== -1) {
          params[prop] = window[val]
        }
      })

      let Fn = BMap[key]
      Fn && this.map.addControl(new Fn(params))
    })
  }

  /**
   * 根据配置执行相应方法
   *
   */
  resolveOptions () {
    let BMap = window.BMap

    // 仅加载SDK，不初始化地图
    if (this.dataOnlyGetSdk) {
      return this.loadSdk()
    }

    // 初始化地图
    this.map = new BMap.Map('allmap')
    this.map.centerAndZoom(new BMap.Point(116.404, 39.915), 11)

    // 自动定位、或者手动定位
    this.getPosition ? this.getCurrentLocation() : this.searchLocation()

    // 暴露自动定位方法
    this.addEventAction('getLocal', () => {
      // 可能会在未完全初始化的时候调用
      this.getMapJDK().then(this.getCurrentLocation.bind(this))
    })
    // 配置控件
    this.controls && this.addControls()
  }

  /**
   * 异步加载地图jdk
   *
   */
  getMapJDK () {
    if (!window.BMap) {
      window.BMap = {}
      window.BMap._insertScript = new Promise(resolve => {
        window._initBaiduMap = () => {
          resolve(window.BMap)
          window.document.body.removeChild($script)
          window.BMap._insertScript = null
          window._initBaiduMap = null
        }
        let $script = document.createElement('script')
        window.document.body.appendChild($script)
        $script.src = `https://api.map.baidu.com/api?v=2.0&ak=${this.ak}&callback=_initBaiduMap`
      })
      return window.BMap._insertScript
    } else if (!window.BMap._insertScript) {
      return Promise.resolve(window.BMap)
    }
    return window.BMap._insertScript
  }

  firstInviewCallback () {
    let wrapper = document.createElement('div')
    wrapper.id = 'allmap'
    this.element.appendChild(wrapper)

    this.getMapJDK().then(this.resolveOptions.bind(this))
  }
}
