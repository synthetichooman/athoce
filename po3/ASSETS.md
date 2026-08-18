# Exhibition image workflow

고해상도 원본은 프로젝트 루트의 `_exhibition-source/`에 둔다. 이 폴더는 `.gitignore`에
포함되어 Cloudflare Pages 배포와 Git 커밋에서 제외된다.

```text
_exhibition-source/
├── editorial/
│   ├── editorial-01.jpg
│   └── ...
└── looks/
    ├── aategois_가영_1.png
    ├── aategois_가영_2.png
    ├── aategois-exhibition.png
    ├── hooman_유민_1.png
    ├── hooman_유민_2.png
    ├── hooman-exhibition.png
    ├── cementbay_세연_1.png
    ├── cementbay_세연_2.png
    └── cementbay-exhibition.png
```

- 누끼 착장은 투명 배경 PNG를 권장한다.
- `aategois`는 `aategois_가영_1`, `aategois_가영_2`, `aategois-exhibition` 순서다.
- `hooman`은 `hooman_유민_1`, `hooman_유민_2`, `hooman-exhibition` 순서다.
- `cementbay`는 `cementbay_세연_1`, `cementbay_세연_2`, `cementbay-exhibition` 순서다.
- 각 숍의 앞 두 파일은 에디토리얼 착장, `-exhibition` 파일은 전시 추가 착장이다.
- `scripts/prepare_exhibition_images.sh`를 실행하면 웹용 WebP가 생성된다.
- 착장 브랜드 정보는 `po3/app.js`의 `shops` 배열에서 수정한다.
