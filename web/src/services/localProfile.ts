import { create } from 'zustand'

/**
 * 本地用户资料：不登录也能有个自己的昵称和头像，侧边栏「用户信息」可以选它。
 * 头像压缩成 256px 的 JPEG 存 localStorage，避免把原图塞进存储。
 */

const KEY = 'chat-demo:local-profile'

type LocalProfile = {
  nickname: string
  /** data:image/jpeg;base64,... */
  avatar: string
}

const AVATAR_SIZE = 256

const load = (): LocalProfile => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return { nickname: '', avatar: '' }
    }
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    return {
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : '',
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '',
    }
  } catch {
    return { nickname: '', avatar: '' }
  }
}

const save = (profile: LocalProfile) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // 头像太大导致配额满时忽略，界面仍保留本次修改
  }
}

type LocalProfileState = LocalProfile & {
  setNickname: (nickname: string) => void
  setAvatar: (avatar: string) => void
}

export const useLocalProfile = create<LocalProfileState>((set, get) => ({
  ...load(),
  setNickname: (nickname) => {
    save({ ...get(), nickname })
    set({ nickname })
  },
  setAvatar: (avatar) => {
    save({ ...get(), avatar })
    set({ avatar })
  },
}))

/** 把用户选的图片裁成正方形并压到 256px，返回 dataURL；失败返回空串 */
export const readAvatar = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const side = Math.min(image.width, image.height)
        const canvas = document.createElement('canvas')
        canvas.width = AVATAR_SIZE
        canvas.height = AVATAR_SIZE
        const context = canvas.getContext('2d')
        if (!context) {
          resolve('')
          return
        }
        context.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          AVATAR_SIZE,
          AVATAR_SIZE
        )
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        resolve('')
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    image.src = url
  })
