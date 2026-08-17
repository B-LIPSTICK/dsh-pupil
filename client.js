// dsh-eye · 浏览器端（client half）
//
// 平台限制：DSH GUI 的工具结果卡默认不渲染图片块。本模块为 image_generate
// 注册一个工具卡渲染器：结果里含图片附件时，直接在对话内嵌显示生成图
// （ImageGallery），用户无需打开文件即可预览。
//
// 机制：keyed slot "tool.call.toolview"（按工具名分派）→ 渲染组件从
// block.content 提取 image 块 → ctx.sessions.binding(sessionId).session
// .readAttachment 拉取字节 → Blob URL 交给 ImageGallery。
window.__ModuleLoader__.load({
  id: 'dsh-eye',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { ImageGallery } = require('@deepseek-ai/dsh-client-ui-attachment')

    // 固定中文展示文案（轻量；不引入 locale 系统）
    const LABELS = {
      image: '已生成图片',
      open: '打开图片',
      openNamed: (name) => `打开「${name}」`,
      loading: '图片加载中…',
      loadFailed: '图片加载失败，点击重试',
      lightbox: { dialog: '图片预览', close: '关闭预览' },
    }

    /** 递归提取工具结果中的文本（供无图时的降级展示）。 */
    function textOf(block) {
      if (!block) return undefined
      if (typeof block === 'string') return block
      if (typeof block.text === 'string') return block.text
      if (Array.isArray(block.content)) {
        return block.content.map((child) => textOf(child)).filter((part) => part !== undefined).join('\n')
      }
      if (block.result !== undefined && block.result !== null) return textOf(block.result)
      return undefined
    }

    const generatedImageUrls = new Set()

    /** 通过会话绑定拉取附件字节并生成 Blob URL。 */
    function loadGeneratedImage(ctx, sessionId, attachment) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return Promise.reject(new Error(`dsh-eye: unknown session ${String(sessionId)}`))
      return (async () => {
        const result = await binding.session.readAttachment(attachment.attachmentId)
        if (!result.ok) {
          throw new Error(`dsh-eye: ${result.error.code}: ${result.error.message}`)
        }
        const ref = result.value.attachment
        const data = result.value.data
        if (typeof URL.createObjectURL === 'function') {
          const url = URL.createObjectURL(new Blob([data], { type: ref.mediaType }))
          generatedImageUrls.add(url)
          return url
        }
        let binary = ''
        const chunk = 0x8000
        for (let offset = 0; offset < data.length; offset += chunk) {
          binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
        }
        return `data:${ref.mediaType};base64,${btoa(binary)}`
      })()
    }

    function apply(ctx) {
      /**
       * 生成图工具卡：结果含图片附件时内嵌预览；无图时降级为结果文本。
       * @param props - slots 框架注入：{ block, sessionId, toolName, ... }
       */
      const GeneratedImageCard = (props) => {
        const { block, sessionId } = props
        const content = block && Array.isArray(block.content) ? block.content : []
        const images = content
          .filter((item) => item && item.type === 'image' && item.attachment)
          .map((item) => ({ attachment: item.attachment }))
        if (images.length === 0) {
          const raw = textOf(block)
          return React.createElement(
            'div',
            { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '4px 0', whiteSpace: 'pre-wrap' } },
            raw ?? '',
          )
        }
        return React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '4px 0' } },
          React.createElement(ImageGallery, {
            images,
            align: 'start',
            labels: LABELS,
            load: (attachment) => loadGeneratedImage(ctx, sessionId, attachment),
          }),
        )
      }

      ctx.slots.inject('tool.call.toolview', function* () {
        yield ctx.slots.register(
          { name: 'tool.call.toolview', key: 'image_generate', priority: -10, inject: () => ({}) },
          GeneratedImageCard,
        )
      })
      ctx.effect(
        () => () => {
          for (const url of generatedImageUrls) URL.revokeObjectURL(url)
          generatedImageUrls.clear()
        },
        'dsh-eye: generated image URL cache',
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions']
    return module.exports
  },
})
