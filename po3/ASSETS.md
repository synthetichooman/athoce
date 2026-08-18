# Exhibition image workflow

고해상도 원본은 프로젝트 루트의 `_exhibition-source/`에 둔다. 이 폴더는 `.gitignore`에
포함되어 Cloudflare Pages 배포와 Git 커밋에서 제외된다.

```text
_exhibition-source/
├── editorial/
│   ├── editorial-01.jpg
│   └── ...
└── looks/
    ├── yumin-01.png
    ├── yumin-02.png
    ├── gayoung-01.png
    ├── gayoung-02.png
    ├── seyeon-01.png
    └── seyeon-02.png
```

- 누끼 착장은 투명 배경 PNG를 권장한다.
- 파일명은 위 이름을 그대로 사용한다.
- `scripts/prepare_exhibition_images.sh`를 실행하면 웹용 WebP가 생성된다.
- 착장 브랜드 정보는 `po3/app.js`의 `looks` 배열에서 수정한다.
