Remote Containerで使用する場合は、`.npmrc`に以下を追加する

```.npmrc
package-import-method=clone-or-copy
store-dir=/.pnpm-store
```

動作確認
```
npm run dev
```
