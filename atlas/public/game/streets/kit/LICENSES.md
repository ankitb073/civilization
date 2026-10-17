# Streets kit: sources and licences

Files in this folder (`*.gltf`, `*.bin`, `tex/**.ktx2`, `kit.json`) are the Pumi hero-district kit for *Runner of the Tablet House* (`#/streets`). They are built by the scripts in `scripts/streets/kit/` (Blender 5.2 headless, numpy, basisu, glTF-Transform); every asset can be regenerated from them.

## What is ours

All geometry (architecture, props, vegetation) is modelled procedurally by those scripts; none is taken from a third-party model unless listed below. Textures are built by `textures_*.py` from the CC0 scans listed below plus procedural layers (brick bonds, straw and chaff, cracks, weaves, end grain, patterns, foliage cards). This derived work is part of this repository and carries its licence. The scans themselves stay CC0.

## Third-party sources (all CC0 1.0 Universal)

Poly Haven (https://polyhaven.com) publishes every asset under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/); attribution is not required and is given anyway. Downloads were kept in their own folder (`build/kit/downloads/polyhaven/<id>/`), only image and model files were fetched (`fetch_polyhaven.py`), and they were read as data, never executed.

| Asset | Kind | Authors | Licence | Used by |
|---|---|---|---|---|
| [Bark Willow 02](https://polyhaven.com/a/bark_willow_02) (`bark_willow_02`) | texture | Charlotte Baglioni | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Brown Mud Dry](https://polyhaven.com/a/brown_mud_dry) (`brown_mud_dry`) | texture | Rob Tuytel | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Clay Block Wall](https://polyhaven.com/a/clay_block_wall) (`clay_block_wall`) | texture | Amal Kumar | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Clay Plaster](https://polyhaven.com/a/clay_plaster) (`clay_plaster`) | texture | Amal Kumar | CC0 1.0 | `scripts/streets/kit/textures_arch.py`, `scripts/streets/kit/textures_struct.py` |
| [Dirt](https://polyhaven.com/a/dirt) (`dirt`) | texture | Charlotte Baglioni | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Dry Ground 01](https://polyhaven.com/a/dry_ground_01) (`dry_ground_01`) | texture | Rob Tuytel | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Hessian 230](https://polyhaven.com/a/hessian_230) (`hessian_230`) | texture | colormass, Rico Cilliers | CC0 1.0 | `scripts/streets/kit/textures_props.py` |
| [Mud Cracked Dry 03](https://polyhaven.com/a/mud_cracked_dry_03) (`mud_cracked_dry_03`) | texture | Dario Barresi, Dimitrios Savva | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |
| [Rough Linen](https://polyhaven.com/a/rough_linen) (`rough_linen`) | texture | colormass, Rico Cilliers | CC0 1.0 | `scripts/streets/kit/textures_struct.py` |
| [Rough Wood](https://polyhaven.com/a/rough_wood) (`rough_wood`) | texture | Rob Tuytel | CC0 1.0 | `scripts/streets/kit/textures_arch.py` |

**Used only to light the review renders (not shipped):** [Qwantani Late Afternoon (Pure Sky)](https://polyhaven.com/a/qwantani_late_afternoon_puresky) by Greg Zaal, Jarod Guest, CC0 1.0; [Qwantani Mid Morning (Pure Sky)](https://polyhaven.com/a/qwantani_mid_morning_puresky) by Greg Zaal, Jarod Guest, CC0 1.0.

**Downloaded for evaluation, not used in shipped files:** [bark_platanus](https://polyhaven.com/a/bark_platanus), [dry_mud_field_001](https://polyhaven.com/a/dry_mud_field_001), [palm_bark](https://polyhaven.com/a/palm_bark), [patterned_clay_plaster](https://polyhaven.com/a/patterned_clay_plaster), [sand_01](https://polyhaven.com/a/sand_01), [weathered_planks](https://polyhaven.com/a/weathered_planks), [withered_grass](https://polyhaven.com/a/withered_grass) (all CC0 1.0).

The review renders also place the runner (`../runner.glb`, CC0, see `../LICENSES.md`) for scale.

### Files fetched (URL and SHA-256)

- `bark_platanus`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/bark_platanus/bark_platanus_diff_2k.jpg `68b2a75c71674dce0a1139aa0602df7b7e6d26cc0b3286f6e1e6bf33965cfd17`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/bark_platanus/bark_platanus_disp_2k.png `43b6c7fba900d96df0c9a35e04927604c3afe879ad4af03cabb5026d002d5660`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/bark_platanus/bark_platanus_rough_2k.jpg `97c3971c17f696cea09a6a5c12ae6a83b35080262f6d38024eab99f72b20a617`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/bark_platanus/bark_platanus_nor_gl_2k.png `4c784a4ad4d357055a991a687ec80079ef5a4980b691d1767ef90465046fc331`
- `bark_willow_02`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/bark_willow_02/bark_willow_02_ao_2k.jpg `90bef89e48b0954f7c7aca7fa69c7facf30dfac30170c66178defdb5cc19609e`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/bark_willow_02/bark_willow_02_diff_2k.jpg `6bec05b58cad3907ba2704010f2d6878152b679e5f5ab5c6c6ff7d449c373a76`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/bark_willow_02/bark_willow_02_disp_2k.png `dab4417023bb94e9869a7465e766b796982b4419700d802ea6514c157871b4af`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/bark_willow_02/bark_willow_02_rough_2k.jpg `360bfce5b6f8ff6fd6ab5c8b61dcdaa4bcc36c86c920964c71d38e8fc671ebcb`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/bark_willow_02/bark_willow_02_nor_gl_2k.png `d8bb42ffd6e161b60d9958bc5eae548ecc7575a1fa68bb8aa600bf5c4b877aa4`
- `brown_mud_dry`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/brown_mud_dry/brown_mud_dry_ao_2k.jpg `288b72bd1b791de9c18470e449daf881804421c9455f761317648cb79aa3e274`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/brown_mud_dry/brown_mud_dry_diff_2k.jpg `5f567f61a7e139101441a1209e9c174a4f92dce489b28bb168f6bfd0ca07e411`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brown_mud_dry/brown_mud_dry_disp_2k.png `c882cc0da52d76a968158fff376d6685eeeaf1afe38d14a1f3949adb6d01fa56`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/brown_mud_dry/brown_mud_dry_rough_2k.jpg `f4038e84a4b3b9b7efa95d63d66bbdca27edddb2de9b496084cf140b18d75923`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brown_mud_dry/brown_mud_dry_nor_gl_2k.png `3ad892a618f546cc572eecd1ee28103f8c3a3a2d9d8b9b5667ec32fecdfee0b6`
- `clay_block_wall`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/clay_block_wall/clay_block_wall_diff_2k.jpg `dd1b26e4a1a5d751a84f87fcd95c17401779f2913f46d2c51da7bba7a2ddc499`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/clay_block_wall/clay_block_wall_disp_2k.png `2e029df558ebc7bacf0d5db7a11a00197d5a829e7dfd84eb0a4dc9cffed261c2`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/clay_block_wall/clay_block_wall_rough_2k.jpg `43d0cc75db40813025e2486e3f7cd061f65453d11adfde0dc41a85f19a02a188`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/clay_block_wall/clay_block_wall_nor_gl_2k.png `7e53f9d237c6f97887500f6aa17562cdc3872d04e2c0ef27f7131c72099de9aa`
- `clay_plaster`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/clay_plaster/clay_plaster_ao_4k.jpg `f4ad100071add2830d6e781dd92c84ab921c8068a51ad486f96dc50afb7b513f`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/clay_plaster/clay_plaster_diff_4k.jpg `6e24d01ae7135cb43ae5c0621d9c0f724f757c71272b926eb80f853fc98eca47`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/4k/clay_plaster/clay_plaster_disp_4k.png `9b50949c6c5d66532e497358ac39562b8540832e2e9c8b9a1fc7ba923331588b`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/clay_plaster/clay_plaster_rough_4k.jpg `5da40d49d65719f7072b63ce04fa8f365a6e5ab48e06a57c73b48ea32a8761ff`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/4k/clay_plaster/clay_plaster_nor_gl_4k.png `8180a8502f94324a45d3416431fd3e9c726845a2a23463ba156ea418a1fa71da`
- `dirt`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dirt/dirt_ao_2k.jpg `5c6f36c9cfc6a03faca87d5407eaa26e18d33c0b3762016de023a5cafa3e2246`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dirt/dirt_diff_2k.jpg `126d3e4886cc94b494ba609ddc323a77ff0362a1b156c3750d5d2a0a0ead02b8`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dirt/dirt_disp_2k.png `0922d5f74b103921df549c4a1b7441c7023376c1a99714d05710ffd80cc8af97`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dirt/dirt_rough_2k.jpg `a17048230e1a86fc874b381360f6a821df1f6b0174ca7f85a59596c4290080fa`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dirt/dirt_nor_gl_2k.png `d269f7e4c8f113474735c1d9e346f48272dcb5c2cba72c3976b0181a0867d7aa`
- `dry_ground_01`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dry_ground_01/dry_ground_01_diff_2k.jpg `b6b601e75ba68d91ea1b09af87e95f186d15d8210e4f14692f9b20d2e21d437b`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dry_ground_01/dry_ground_01_disp_2k.png `e269ad908c274ce92aede853259d7e292b3ab144507b643f766f5f40c6420b3f`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dry_ground_01/dry_ground_01_rough_2k.jpg `a63000ba9e78a8ad5ddd1ea128ed20d91e68dba841c486af7292b8e7724c685a`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dry_ground_01/dry_ground_01_nor_gl_2k.png `763a8785f9d1d333491587fcc180ec6618b5ef123daa86b540e7f8dd75d487f2`
- `dry_mud_field_001`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dry_mud_field_001/dry_mud_field_001_ao_2k.jpg `a3fe4239b16fed9bbdfcd15d2f13b2567314fbe68eeaa41ceb1321f2b8e8ecdb`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dry_mud_field_001/dry_mud_field_001_diff_2k.jpg `5e4cf51f8ce858a04e19228dc6e1f4956a47e0ee92efa684bd0079e326715b4c`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dry_mud_field_001/dry_mud_field_001_disp_2k.png `35b6d9f07039bf77db8424299df476a6e6ecb207f18307f62474e29a19a2e0c1`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/dry_mud_field_001/dry_mud_field_001_rough_2k.jpg `749d475320fa440a16d87a639e2fad41ef1b28cc268cdcd4e41557fb5870d005`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/dry_mud_field_001/dry_mud_field_001_nor_gl_2k.png `dcc1759dfc39abe33d5c0e47d2db1912eb8952f6965770097af255e999da2114`
- `hessian_230`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/hessian_230/hessian_230_diff_2k.jpg `1c1d66e3764dded1cfafa5147ea56a28ef7648e3c5cae6892b8dada92d408685`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/hessian_230/hessian_230_disp_2k.png `02cbba24dfa937fddfe23df2cf100afedc4ae9f8100d5fa4b2bbb97b17cf0021`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/hessian_230/hessian_230_rough_2k.jpg `6c5be8aff1a36df639bf690e5acdc9116d12389614fb0db26a75ea31b65dd597`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/hessian_230/hessian_230_nor_gl_2k.png `a15dc22dfdc3a57715afca999ae417266096146f63a1f6219066a91d58d65b9d`
- `mud_cracked_dry_03`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/mud_cracked_dry_03/mud_cracked_dry_03_diff_2k.jpg `5f711035ea182d94791259b22576eb4f54912e3f1d56786dcc391982f6f764b4`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/mud_cracked_dry_03/mud_cracked_dry_03_disp_2k.png `da28c56e6236e9d8d22dd555257b65ba2f394bc4cce5dec5e29069e939b6b122`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/mud_cracked_dry_03/mud_cracked_dry_03_rough_2k.jpg `a7c3c963f111135f381a940989a634a6add5c9e36d3c385e36a9beccc4aeda97`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/mud_cracked_dry_03/mud_cracked_dry_03_nor_gl_2k.png `c86b49ab2f4f40e12fa6e6a7d74895f09b231b6a2b721e6c6063ba09d9c364f6`
- `palm_bark`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/palm_bark/palm_bark_diff_2k.jpg `5be19ff60fef0cbddb4381e345a76fdeabcc184d643efbf55f0b34ec687cf480`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/palm_bark/palm_bark_disp_2k.png `2904ce93d56ac781a22736adcaeed4a89fee1af6b963e699bbbb7de338cce8ca`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/palm_bark/palm_bark_rough_2k.jpg `385d843d72193f1039fe9fa5ca521c0cc8ad335c9e456cff21beb727a36896cf`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/palm_bark/palm_bark_nor_gl_2k.png `7e20453e9f10f999e42a40a7bbe7f3b73949af340a3783205a6879c472137ed8`
- `patterned_clay_plaster`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/patterned_clay_plaster/patterned_clay_plaster_ao_2k.jpg `5f1ae38c7264a392e59b42cf0cdea5699e43ad13564bee4939afd7bee1d78aa5`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/patterned_clay_plaster/patterned_clay_plaster_diff_2k.jpg `58f841b0340359202d0bc9cd0f6e258ac5a2a0893b6fff6601e2948108cfd400`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/patterned_clay_plaster/patterned_clay_plaster_disp_2k.png `ac9a523d62221e941c1ec28852afe8b7bf37bd3b3bdaa6aec82de8e9cb8427d2`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/patterned_clay_plaster/patterned_clay_plaster_rough_2k.jpg `c91cf4bb488e79b3c4971a0cbd94e7977e10a7f682f153865410012e1adadee6`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/patterned_clay_plaster/patterned_clay_plaster_nor_gl_2k.png `91675b2ab9b83488033eb5bb56b29a9b65916baa714ff4c9772023dd1565125e`
- `qwantani_late_afternoon_puresky`:
  - hdri: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/qwantani_late_afternoon_puresky_4k.hdr `d820fa7a84732f69641655dcbea33b01ff78e6a4833ee3ca6f3bc938a0c09bb7`
- `qwantani_mid_morning_puresky`:
  - hdri: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/qwantani_mid_morning_puresky_4k.hdr `4be801e10a78129073a0812ec986070ceff8e315c9ad9bef986874b865334200`
- `rough_linen`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rough_linen/rough_linen_diff_2k.jpg `e71016e08dfebea1dd4e8a2a675e3b617a889a782af782f1abb795906f4db1b4`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/rough_linen/rough_linen_disp_2k.png `f50d326854357cfcce3b8af26169502d7065282f787439e0b63a7fed23444a55`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rough_linen/rough_linen_rough_2k.jpg `48400d48fa203882bf5d984d5beb2f95edb1550309924601c018f2c4f3f80731`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/rough_linen/rough_linen_nor_gl_2k.png `1de2d1e782a54340b9a047a78382c1a0218cc1933bdffb331d6ed5fa2164e932`
- `rough_wood`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/rough_wood/rough_wood_ao_4k.jpg `38707ab74097cb9e29316fd56e30ee7c795033f7dd9b7972738a477c3ae74c33`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/rough_wood/rough_wood_diff_4k.jpg `2a7714192151b892e1fc3850e0d83beac385b933e7615b356d5537aa42ad3410`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/4k/rough_wood/rough_wood_disp_4k.png `1089a8cfb0e363035d2b55c33df799497170ca14b8355be86cf6181fa4c19375`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/rough_wood/rough_wood_rough_4k.jpg `0a03b6b9fe51fc66c36a3f133075a4675af034042aef6077383f64f354046855`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/4k/rough_wood/rough_wood_nor_gl_4k.png `0a62178186bd5145f0735860fda897b8765e11ce7ad891c3e612392e32c7831c`
- `sand_01`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sand_01/sand_01_diff_2k.jpg `f311767ab68e132cb9de4160493a71ff17ec765c699d411facd5154d9a9a9c18`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/sand_01/sand_01_disp_2k.png `3a2cfb70b8e688f4b9d09b08684e94e4dfb5ad934d042c8d71879b8b612f3b7a`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sand_01/sand_01_rough_2k.jpg `60ec73993d245be5dab83f9debb67cab4303a0af9d4cec3f28868a58f939f8db`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/sand_01/sand_01_nor_gl_2k.png `fc1d2f1af4c6166cbc0dc696999f7a92a207b8fbd22208fa384a6c03299b942f`
- `weathered_planks`:
  - AO: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/weathered_planks/weathered_planks_ao_2k.jpg `3f797b00bc63c54a45e17f8b6ffcd9a6709d29e88b51049dbda4b0430c7cc7c4`
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/weathered_planks/weathered_planks_diff_2k.jpg `e763f1257acdfdbb31764c9ec9d480fd4efa5cc008f8b63d73a916d53d938942`
  - Displacement: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/weathered_planks/weathered_planks_disp_2k.png `4c250a7eb2668cc726e5a0118cddbf8b43e9e5f613ec5121e3fd6bc4c5c5ad96`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/weathered_planks/weathered_planks_rough_2k.jpg `964c154545e1ac4e1cb4b2ba60960a1effa2c56c31a2c300bf78fcc499b17c52`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/weathered_planks/weathered_planks_nor_gl_2k.png `8ae4f3c4f250464b43f0d446790bcc3b97e8edf4ee43a6c7f7c0613710da3721`
- `withered_grass`:
  - Diffuse: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/withered_grass/withered_grass_diff_2k.jpg `0cf0fca68cbf4277199a2b9b7b3a8013357e4087247b1367f86d4a53b4fafa7e`
  - Rough: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/withered_grass/withered_grass_rough_2k.jpg `86adb8d6f24d0a38eb96c6b625f2dd027b805f59af46fe2a05ffe29f633e33c8`
  - nor_gl: https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/withered_grass/withered_grass_nor_gl_2k.png `5b4be863674ec322952cc3e0aa2a33980b194ad65d83ff012e348ae4bd38849f`
