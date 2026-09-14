import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'EzSubtitle',
    description: 'Lấy phụ đề YouTube và chuẩn bị bản tóm tắt trên ChatGPT.',
    permissions: ['activeTab', 'storage', 'clipboardWrite', 'tabs'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://m.youtube.com/*',
      'https://youtu.be/*',
      'https://www.youtube-nocookie.com/*',
      'https://chatgpt.com/*',
    ],
    action: {
      default_title: 'EzSubtitle',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    web_accessible_resources: [{
      resources: ['icon/32.png'],
      matches: [
        'https://www.youtube.com/*',
        'https://youtube.com/*',
        'https://m.youtube.com/*',
      ],
    }],
  },
});
