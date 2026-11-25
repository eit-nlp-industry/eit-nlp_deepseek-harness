window.__ModuleLoader__.load({
  id: '@local/dsh-robot-dog-v03-vision-console',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const card = {
      position: 'fixed',
      right: 16,
      bottom: 16,
      width: 340,
      maxHeight: '78vh',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 60,
      borderRadius: 12,
      border: '1px solid rgba(0,0,0,0.12)',
      background: '#fff',
      color: '#1b1b1f',
      boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
      font: '12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif',
      overflow: 'hidden',
    }
    const head = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 10px',
      background: '#f4f5f7',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      cursor: 'pointer',
      userSelect: 'none',
    }
    const body = { padding: 10, display: 'grid', gap: 8, overflowY: 'auto', maxHeight: '68vh' }
    const row = { display: 'flex', alignItems: 'center', gap: 6 }
    const label = { color: '#5b5b66', whiteSpace: 'nowrap' }
    const select = { flex: 1, minWidth: 0, font: 'inherit', padding: '3px 4px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.16)' }
    const input = { width: 72, font: 'inherit', padding: '3px 4px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.16)' }
    const button = running => ({
      font: 'inherit',
      padding: '4px 10px',
      borderRadius: 6,
      border: '1px solid rgba(0,0,0,0.16)',
      background: running ? '#fdecea' : '#e8f2ff',
      cursor: 'pointer',
    })
    const dot = on => ({
      width: 8,
      height: 8,
      borderRadius: 4,
      background: on ? '#2e9e5b' : '#b8b8bf',
      display: 'inline-block',
    })
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }
    const tabs = { display: 'flex', gap: 4, padding: 2, borderRadius: 8, background: '#f4f5f7' }
    const tab = on => ({
      flex: 1,
      font: 'inherit',
      padding: '4px 8px',
      borderRadius: 6,
      border: '1px solid transparent',
      background: on ? '#fff' : 'transparent',
      boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      cursor: 'pointer',
    })

    // The page may be served under a reverse-proxy prefix (or the API may live on
    // its own origin), so the base is probed instead of assumed: `/vision-v03`
    // first, then the page's own directory prefix.
    const baseCandidates = () => {
      const list = ['/vision-v03']
      try {
        const here = new URL('.', document.baseURI).pathname.replace(/\/$/, '')
        if (here !== '' && here !== '/') list.push(`${here}/vision-v03`)
      } catch {
        // document.baseURI is always available in a browser; ignore oddities.
      }
      return list
    }

    const OPEN_KEY = 'vision-console-v03-open'
    const readOpen = () => {
      try {
        const value = localStorage.getItem(OPEN_KEY)
        if (value === '0') return false
        if (value === '1') return true
      } catch {
        // private mode / blocked storage — fall back to default
      }
      return true
    }
    const writeOpen = next => {
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
    }

    function Panel() {
      const [open, setOpen] = React.useState(readOpen)
      const [state, setState] = React.useState(null)
      const [sessionId, setSessionId] = React.useState('')
      const [video, setVideo] = React.useState('')
      const [intervalMs, setIntervalMs] = React.useState(1000)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [diag, setDiag] = React.useState('')
      const [base, setBase] = React.useState('/vision-v03')
      const [tick, setTick] = React.useState(0)
      const [injectNote, setInjectNote] = React.useState('')
      const [mode, setMode] = React.useState('video')

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          const tried = []
          for (const candidate of baseCandidates()) {
            try {
              const response = await fetch(`${candidate}/state`, { cache: 'no-store' })
              const contentType = response.headers.get('content-type') ?? ''
              tried.push(`${candidate}/state -> ${response.status} ${contentType.split(';')[0]}`)
              if (!response.ok || !contentType.includes('json')) continue
              const next = await response.json()
              if (!alive) return
              setBase(candidate)
              setState(next)
              setError('')
              setDiag(tried.join(' | '))
              if (next.sessionId !== null && next.sessionId !== undefined) setSessionId(current => current || next.sessionId)
              if (typeof next.videoName === 'string' && next.videoName.length > 0) setVideo(current => current || next.videoName)
              return
            } catch (cause) {
              tried.push(`${candidate}/state -> ${String(cause).slice(0, 80)}`)
            }
          }
          if (alive) {
            setError('拿不到 /vision-v03/state')
            setDiag(tried.join(' | ') || 'no attempt')
          }
        }
        void load()
        const loadTimer = setInterval(load, 1500)
        const frameTimer = setInterval(() => setTick(value => value + 1), 1000)
        return () => {
          alive = false
          clearInterval(loadTimer)
          clearInterval(frameTimer)
        }
      }, [])

      const post = async (path, payload) => {
        setBusy(true)
        try {
          const response = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
          })
          const next = await response.json().catch(() => null)
          if (!response.ok) {
            setError((next && next.error) || `HTTP ${response.status}`)
            return null
          }
          setError('')
          if (next) setState(next)
          return next
        } catch (cause) {
          setError(String(cause))
          return null
        } finally {
          setBusy(false)
        }
      }

      const fileToJpeg = file => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const image = new Image()
        image.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d')
          if (context === null) {
            URL.revokeObjectURL(url)
            reject(new Error('无法读取图片'))
            return
          }
          context.drawImage(image, 0, 0)
          URL.revokeObjectURL(url)
          resolve(canvas.toDataURL('image/jpeg', 0.92))
        }
        image.onerror = () => {
          URL.revokeObjectURL(url)
          reject(new Error(`无法读取 ${file.name}`))
        }
        image.src = url
      })

      const injectFiles = async event => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return
        if (sessionId === '') {
          setError('先选择目标会话')
          return
        }
        const limit = 3
        if (files.length > limit) {
          setError(`一次最多 ${limit} 张`)
          return
        }
        setBusy(true)
        setInjectNote('')
        try {
          const images = []
          for (const file of files) images.push(await fileToJpeg(file))
          const response = await fetch(`${base}/inject`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, images }),
          })
          const next = await response.json().catch(() => null)
          if (!response.ok) {
            setError((next && next.error) || `HTTP ${response.status}`)
            return
          }
          setError('')
          if (next) setState(next)
          const frames = Array.isArray(next?.frames) ? next.frames.join('、') : ''
          setInjectNote(frames ? `已作为环境观察推送：${frames}` : '已推送')
        } catch (cause) {
          setError(String(cause))
        } finally {
          setBusy(false)
        }
      }

      const running = state?.running === true
      const sessions = Array.isArray(state?.sessions) ? state.sessions : []
      const videos = Array.isArray(state?.videos) ? state.videos : null
      const currentVideo = typeof state?.videoName === 'string' ? state.videoName : ''
      const videoOptions = videos === null
        ? []
        : (currentVideo.length > 0 && !videos.includes(currentVideo) ? [currentVideo, ...videos] : videos)
      const frameSrc = state?.frameSequence === null || state?.frameSequence === undefined
        ? null
        : `${base}/frame.jpg?t=${tick}`

      return h('div', { style: card },
        h('div', { style: head, onClick: () => setOpen(value => {
          const next = !value
          writeOpen(next)
          return next
        }) },
          h('div', { style: row },
            h('span', { style: dot(running) }),
            h('strong', null, '观察调试 · v0.3'),
            h('span', { style: { ...label, ...mono } }, state?.camera?.sequence ? `#${state.camera.sequence}` : '无帧'),
          ),
          h('span', { style: label }, open ? '收起' : '展开'),
        ),
        open
          ? h('div', { style: body },
              h('div', { style: tabs },
                h('button', { type: 'button', style: tab(mode === 'video'), onClick: () => setMode('video') }, '视频推送'),
                h('button', { type: 'button', style: tab(mode === 'still'), onClick: () => setMode('still') }, '上传图片'),
              ),
              h('div', { style: row },
                h('span', { style: label }, '目标会话'),
                h('select', {
                  style: select,
                  value: sessionId,
                  disabled: running || busy,
                  onChange: event => setSessionId(event.target.value),
                },
                  h('option', { value: '' }, sessions.length === 0 ? '（没有会话）' : '请选择…'),
                  sessions.map(session => h('option', { key: session.id, value: session.id, title: session.id },
                    session.label ?? session.preset ?? String(session.id),
                  )),
                ),
              ),
              mode === 'video'
                ? h(React.Fragment, null,
                    h('div', {
                      style: {
                        height: 132,
                        borderRadius: 8,
                        background: '#0f1115',
                        display: 'grid',
                        placeItems: 'center',
                        overflow: 'hidden',
                      },
                    },
                      frameSrc
                        ? h('img', { src: frameSrc, alt: 'latest frame', style: { width: '100%', height: '100%', objectFit: 'cover' } })
                        : h('span', { style: { color: '#8890a0' } }, '还没有帧'),
                    ),
                    videos === null
                      ? null
                      : h('div', { style: row },
                          h('span', { style: label }, '视频'),
                          h('select', {
                            style: select,
                            value: video,
                            disabled: busy,
                            onChange: async event => {
                              const next = event.target.value
                              const previous = video
                              setVideo(next)
                              const result = await post('/select', { video: next })
                              if (result === null) setVideo(previous)
                            },
                          },
                            h('option', { value: '' }, videoOptions.length === 0 ? '（没有视频）' : '请选择视频…'),
                            videoOptions.map(name => h('option', { key: name, value: name, title: name }, name)),
                          ),
                        ),
                    h('div', { style: row },
                      h('span', { style: label }, '采样(ms)'),
                      h('input', {
                        style: input,
                        type: 'number',
                        min: 500,
                        step: 500,
                        value: intervalMs,
                        disabled: running || busy,
                        onChange: event => setIntervalMs(Number(event.target.value) || 1000),
                      }),
                      h('span', { style: { ...label, ...mono } },
                        state ? `推 ${state.pushed} / 缓 ${state.bufferedFrames ?? 0} / 采 ${state.sampled ?? 0}` : '',
                      ),
                    ),
                    h('div', { style: row },
                      h('button', {
                        style: button(running),
                        disabled: busy || running || sessionId === '' || (videos !== null && video === ''),
                        onClick: () => post('/start', { sessionId, intervalMs, video: video || undefined }),
                      }, running ? '推送中…' : '开始推送'),
                      h('button', {
                        style: button(false),
                        disabled: busy || !running,
                        onClick: () => post('/stop', {}),
                      }, '停止'),
                    ),
                  )
                : h(React.Fragment, null,
                    h('div', { style: { color: '#5b5b66' } }, '选 1 到 3 张图，作为一次环境观察推到上面的会话，并登记 frame_id，供 annotate_target 使用。'),
                    h('input', {
                      type: 'file',
                      accept: 'image/*',
                      multiple: true,
                      disabled: busy || sessionId === '',
                      onChange: injectFiles,
                      style: { font: 'inherit' },
                    }),
                    injectNote
                      ? h('div', { style: { color: '#1b6b3a', ...mono } }, injectNote)
                      : null,
                  ),
              (error || state?.lastError || state?.camera?.lastError)
                ? h('div', {
                    title: error || state?.lastError || (state?.camera?.lastError ? `解码器：${state.camera.lastError}` : ''),
                    style: {
                      color: '#b3261e',
                      ...mono,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                    },
                  }, error || state?.lastError || `解码器：${state?.camera?.lastError}`)
                : null,
              error
                ? h('div', { style: { color: '#8a8a94', ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    `base=${base}${diag ? ` · ${diag}` : ''}`,
                  )
                : null,
            )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'vision-console-v03',
          order: 90,
        }, Panel))
      },
    }
  },
})
