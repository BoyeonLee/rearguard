# RearGuard SBC 컨테이너 구조 설계서 (스마트폰 = SBC)

> 기반 문서: PRD v0.3 (1.2 최종 제품 구상), 하드웨어 부품 선정 보고서 v0.1(`hardware_parts_design.md`), 추론 엔진 선정 보고서(`inference_engine_selection.md`)
> 문서 버전: v0.2 / 작성일: 2026-10-16
> 목적: 스마트폰 앱 출시 시점에 **시트포스트에 후방으로 거치한 스마트폰(= SBC)** 안의 소프트웨어를 격리 단위로 나누고, 단위마다 **역할·권한·재시작 정책·통신 방식**을 정한다. 핵심 질문은 "어느 부분이 죽어도 후방 경고등은 꺼지지 않는가"이다.
>
> v0.2 변경: v0.1의 별도 보드(Raspberry Pi 5) 구성을 폐기. RearGuard는 스마트폰 앱이므로 **폰 자체를 SBC로 보고** 다시 설계함.

---

## 0. 결론 요약

### 0.1 Docker 컨테이너 → 스마트폰 격리 단위로 바꾸기

스마트폰(Android·iOS)에서는 앱이 Docker를 쓸 수 없다. 대신 Android는 **한 앱을 여러 OS 프로세스로 나눌 수 있고**(`android:process`), 프로세스마다 메모리·크래시가 분리된다. 첨부 구조의 "컨테이너"를 이 **프로세스**로 옮긴다.

| Docker 개념 | 스마트폰(Android)에서 대응하는 것 |
|---|---|
| 컨테이너 | 앱 안의 별도 프로세스 (`android:process=":safety"` 등) |
| `privileged` / `--device` | 런타임 권한 (`CAMERA`, `BLUETOOTH_CONNECT`). 권한은 앱 단위라, **해당 하드웨어 API를 호출하는 코드를 한 프로세스에만 둔다** |
| broker (MQTT) | **Binder IPC** (AIDL, OS 커널 드라이버). 같은 프로세스 안은 Kotlin Flow |
| `restart: always` | 포그라운드 서비스(FGS) + `START_STICKY` |
| `restart: on-failure` | 다른 프로세스가 바인딩해 두고, 끊기면(`onBindingDied`) 다시 바인딩 |
| `mem_limit` / OOM 순서 | 프로세스별 힙 한도 + Android 메모리 회수 우선순위 (FGS 프로세스가 일반 프로세스보다 나중에 회수됨) |

### 0.2 구성 요약

| # | 구성 요소 | 프로세스 | 기술 스택 | 역할 | 재시작 | 죽었을 때 |
|---|---|---|---|---|---|---|
| 1 | **sensor-collector** | `:vision` | CameraX + SensorManager | 후면 카메라 15fps, IMU 기울기 | [4]와 함께 | 위험도 갱신 멈춤 → [2]가 1초 뒤 0단계 |
| 2 | **safety-output** | `:safety` | Android BLE GATT (Central) | 후방·핸들 유닛에 위험도 전송 | FGS + `START_STICKY` | **ESP32 펌웨어가 1초 뒤 스스로 0단계** |
| 3 | **Binder IPC** | (OS 커널) | AIDL | 프로세스 사이 메시지 전달 | 해당 없음 | 앱이 죽여도 안 죽음 |
| 4 | **ai-inference** | `:vision` | LiteRT (GPU → NPU, 대체 CPU) | 검출 → 추적 → 거리·TTC → 위험도 | [2]가 재바인드 | [2]가 1초 뒤 0단계 (후방등 기본 점등) |
| 5 | **app-ui** | 메인 | Jetpack Compose | 주행 화면, 설정, 장착 보정, 기록 조회 | 일반 | 화면만 사라짐, 경고 동작은 그대로 |
| 6 | **ride-logger** | 메인 | Room + WorkManager | 위험 이벤트 기록, 클립 색인 | 일반 | 기록만 빠짐 |

**한 줄로:** "폰 안에서는 BLE 출력([2])을 가장 작고 단단한 프로세스로 떼어 내고, AI([4])는 다른 프로세스에 가둬 죽어도 되게 만든다. 그리고 **폰 전체가 죽는 경우는 ESP32 펌웨어가 받는다.**"

- 설계 원칙 1 (진짜 최후 안전망은 폰 밖): 폰은 배터리 방전, OS 강제 종료, 발열 차단으로 통째로 죽을 수 있다. 그래서 "절대 죽으면 안 되는 구역"은 폰 안이 아니라 **후방 유닛 ESP32 펌웨어**다. 하드웨어 문서 §3.3의 "BLE가 1초 이상 끊기면 0단계 기본 점등" 규칙이 그 역할을 한다.
- 설계 원칙 2 (폰 안에서는 프로세스로 격리): LiteRT GPU·NPU 델리게이트는 기기마다 네이티브 크래시가 날 수 있다. 같은 프로세스에 BLE 출력이 있으면 함께 죽으므로, [2]를 `:safety` 프로세스로 분리한다.
- 설계 원칙 3 (출력은 받은 대로만): [2]는 판단하지 않는다. 히스테리시스까지 [4]가 처리하고, [2]는 받은 단계를 전달하고 끊기면 0단계를 보낸다. 코드가 작을수록 죽을 일이 줄어든다.

> 참고: 이 문서의 메모리·지연 수치는 **설계 가정값**이다. 중급 Android 기기에서 실측해 §5·§7 표를 갱신한다(§9 검증 항목 C5·C6).

---

## 1. 전제와 범위

### 1.1 출시 구성 (PoC와 달라지는 점)

| 구분 | PoC (현재, PRD 1.1) | 출시 구성 (이 문서, PRD 1.2) |
|---|---|---|
| 카메라·연산 | 녹화 영상 + 노트북 CPU | **스마트폰 후면 카메라 + 모바일 GPU/NPU** |
| 거치 | 삼각대 | 시트포스트 후방 거치 (폰·후방 LED 일체형 마운트) |
| 추론 엔진 | ONNX Runtime / OpenVINO (CPU) | **LiteRT** (추론 엔진 보고서 결론) |
| BLE Central | 노트북 Python `bleak` | **폰 앱의 [2] safety-output** |
| 후방·핸들 유닛 | XIAO ESP32-C3 ×2 | 그대로 유지 (하드웨어 문서 §3, §4) |
| 카메라 각도 보정 (F4) | 삼각대 설정값 입력 | **폰 IMU로 자동 측정** + 장착 높이 1회 입력 |
| 1차 대상 OS | – | **Android** (GPU·NPU 가속 경로가 가장 넓음). iOS는 §8 |

### 1.2 폰이 다루는 하드웨어

| 장치 | Android API | 필요 권한 | 쓰는 구성 요소 |
|---|---|---|---|
| 후면 카메라 | CameraX (Camera2 기반) | `CAMERA` | [1] |
| IMU (가속도·자이로) | `SensorManager` | 없음 (200Hz 이하) | [1] |
| GPU / NPU | LiteRT GPU 델리게이트, Qualcomm·MediaTek NPU 가속 | 없음 | [4] |
| BLE | `BluetoothGatt` (Central) | `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` | [2] |
| 하드웨어 영상 인코더 | `MediaCodec` (H.264) | 없음 | [1] (클립 링버퍼) |
| 저장소 | 앱 전용 저장소 | 없음 | [1], [6] |
| 발열 상태 | `PowerManager.getThermalHeadroom()` | 없음 | [4] |

### 1.3 주행 모드 (화면을 어떻게 둘 것인가)

- 폰은 후방을 보고 거치되므로 라이더가 화면을 볼 수 없다. 경고는 핸들 유닛이 맡는다.
- **주행 중에는 검은 주행 화면(Activity)을 켜 둔다.** `FLAG_KEEP_SCREEN_ON` + 밝기 최소 + 순수 검정 배경(OLED에서 거의 전력을 안 씀).
- 이유: Android 14부터 카메라 포그라운드 서비스는 **앱이 화면에 보이는 상태에서만 시작**할 수 있다. 화면을 끈 뒤 [4]가 크래시해서 `:vision`을 다시 띄워야 할 때 막힐 수 있으므로, 화면을 켜 둬 앱을 항상 "보이는 상태"로 유지한다. iOS도 카메라가 포그라운드에서만 동작하므로(§8) 두 OS의 주행 방식이 같아진다.

---

## 2. 구성도

```
┌────────── 스마트폰 = SBC  (RearGuard Android 앱, 시트포스트 후방 거치) ────────────────────────┐
│                                                                                                │
│  [HW] 후면 카메라, IMU(가속도·자이로), GPU/NPU, BLE 5.x, 저장소                                │
│        │ 권한: CAMERA                                  │ 권한: BLUETOOTH_CONNECT               │
│        ▼                                               ▼                                       │
│  ╔═ :vision 프로세스 (FGS camera) ══════════╗    ┌─ [2] safety-output ────────────────────┐    │
│  ║ ┌─ [1] sensor-collector ───────────────┐ ║    │ Kotlin + Android BLE GATT Central      │    │
│  ║ │ Kotlin + CameraX + SensorManager     │ ║    │ 후방·핸들 유닛에 위험도 1바이트        │    │
│  ║ │ 후면 카메라 15fps, IMU 기울기 100Hz  │ ║    │ 200ms마다 재전송                       │    │
│  ║ │ role: Publisher (같은 프로세스 Flow) │ ║    │                                        │    │
│  ║ │ [하드웨어 입력 구역]                 │ ║    │ role: Subscriber / Actuator            │    │
│  ║ └──────────────────────────────────────┘ ║    │ process: :safety                       │    │
│  ║       │ Flow (프레임 복사 없음)          ║    │ FGS connectedDevice, START_STICKY      │    │
│  ║       ▼                                  ║    │ [폰 안에서 가장 오래 살아야 함]        │    │
│  ║ ┌─ [4] ai-inference ───────────────────┐ ║    └────────────────────────────────────────┘    │
│  ║ │ LiteRT  GPU → NPU (대체: CPU)        │ ║          ▲ sub: onRisk() (oneway)                │
│  ║ │ YOLO26n 검출→추적→거리·TTC→위험도    │ ║          │ 1초 무수신 → 0단계 전송               │
│  ║ │ role: Subscriber → 추론 → Publisher  │ ║          │ [4]가 죽으면 재바인드                 │
│  ║ │ 3회 연속 크래시 → CPU 모드로 강등    │ ║          │                                       │
│  ║ │ [죽어도 되는 구역: [2]는 계속 동작]  │ ║          │                                       │
│  ║ └──────────────────────────────────────┘ ║          │                                       │
│  ╚══════════════════════════════════════════╝          │                                       │
│        │ pub: risk, tracks, event                      │                                       │
│        ▼                                               │                                       │
│  ┌─ [3] Binder IPC (Android OS 제공 메시지 버스) ───────────────────────────────────────────┐  │
│  │ 프로세스 사이 메시지 전달 (AIDL). 같은 프로세스 안은 Kotlin Flow                         │  │
│  │ 앱 코드가 아니라 커널 드라이버라 앱 프로세스가 죽어도 안 죽음  [시스템의 척추]           │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘  │
│        │ sub: tracks, event, status                    ▲ pub: config, cmd                      │
│        ▼                                               │                                       │
│  ╔═ 메인 프로세스 (Activity, 일반 우선순위) ════════════════════════════════════════════════╗  │
│  ║ ┌─ [5] app-ui ───────────────────────────┐  ┌─ [6] ride-logger ──────────────────────┐   ║  │
│  ║ │ Kotlin + Jetpack Compose               │  │ Room DB + WorkManager                  │   ║  │
│  ║ │ 주행 화면(검은 화면), 설정, 장착 보정  │  │ 위험 이벤트 기록, 클립 색인·정리       │   ║  │
│  ║ │ role: Subscriber + Publisher(설정)     │  │ role: Subscriber                       │   ║  │
│  ║ │ [죽어도 경고는 계속 동작]              │  │ [가장 먼저 버려도 되는 구역]           │   ║  │
│  ║ └────────────────────────────────────────┘  └────────────────────────────────────────┘   ║  │
│  ╚══════════════════════════════════════════════════════════════════════════════════════════╝  │
│                                                                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
    │ [2] BLE (위험도 1바이트)                      │ [2] BLE (위험도 1바이트)
    ▼                                               ▼
  [후방 유닛] XIAO ESP32-C3 + 1W 빨강 LED         [핸들 유닛] XIAO ESP32-C3 + WS2812B + 부저
    펌웨어: 1초 무수신 → 0단계 기본 점등            펌웨어: 1초 무수신 → 파랑 점멸
    [최후 안전망: 폰 전체가 죽어도 동작]
```

**읽는 법**
- 이중선(`╔═╗`)은 **OS 프로세스 경계**, 단선(`┌─┐`)은 그 안의 구성 요소다. 프로세스가 다르면 메모리와 크래시가 분리된다.
- [1]과 [4]는 같은 `:vision` 프로세스에 둔다. 카메라 프레임(수 MB)을 프로세스 밖으로 복사하지 않기 위해서이고, 추론이 없으면 카메라만 살아 있어도 쓸모가 없기 때문이다.
- 위험도는 [4] → [3] Binder → [2] 경로로 간다. [2]가 1초 동안 위험도를 못 받으면 스스로 0단계를 보낸다. [2]까지 죽으면 ESP32 펌웨어가 1초 뒤 0단계로 돌아간다. **안전망이 두 겹이다.**

---

## 3. 구성 요소별 명세

### 3.1 [1] sensor-collector (`:vision` 프로세스, 하드웨어 입력 구역)

| 항목 | 내용 |
|---|---|
| 언어·라이브러리 | Kotlin, CameraX `ImageAnalysis` (`STRATEGY_KEEP_ONLY_LATEST`), `SensorManager` |
| 입력 | 후면 메인 카메라 1280×720 @ 15fps (`YUV_420_888`), 가속도·자이로 100Hz |
| 출력 | 같은 프로세스 안의 Kotlin `SharedFlow`로 [4]에 프레임 전달 (복사 없음), IMU 기울기 |
| 클립 링버퍼 | CameraX `VideoCapture` 또는 `MediaCodec` 하드웨어 H.264로 최근 10초를 메모리에 유지. [4]가 2단계 이상 이벤트를 내면 전후 10초를 파일로 저장 |
| 감시 | 프레임이 3초 이상 안 들어오면 카메라를 다시 연다. 3번 실패하면 프로세스를 스스로 종료해 [2]가 다시 띄우게 한다 |

- IMU 값은 두 가지에 쓴다. ① 장착 시 카메라 기울기 자동 측정(F4), ② 주행 중 기울기가 3° 이상 바뀌면 `event/recalibrate`를 보내 정차 후 재보정을 안내한다(PRD 1.2).
- 주행 중 진동으로 프레임이 흔들리는 문제는 OIS(광학 손떨림 보정)가 있는 메인 카메라를 쓰고, 초광각 카메라는 쓰지 않는다(왜곡 보정 비용).

### 3.2 [2] safety-output (`:safety` 프로세스, 폰 안에서 가장 오래 살아야 함)

| 항목 | 내용 |
|---|---|
| 언어·라이브러리 | Kotlin, Android `BluetoothGatt` (Central). 외부 라이브러리 최소화 |
| 서비스 | 포그라운드 서비스 `SafetyService`, 타입 `connectedDevice`, `START_STICKY` |
| 입력 | AIDL `oneway onRisk(level, ts, seq)` ([4]가 호출) |
| 출력 | `RG-REAR`, `RG-HANDLE`에 위험도 1바이트 (Write Without Response), **200ms마다 재전송** |
| BLE 설정 | `requestConnectionPriority(CONNECTION_PRIORITY_HIGH)` (연결 간격 약 11.25~15ms) |
| 메모리 | 약 20~30MB (Kotlin 런타임 포함, 가정값) |

**동작 규칙 (하드웨어 문서 §3.3, §6.2를 폰 쪽으로 옮김)**

| 상황 | [2]가 하는 일 | 후방 LED (ESP32) | 핸들 유닛 (ESP32) |
|---|---|---|---|
| 위험도 정상 수신 | 받은 단계를 그대로 전송, 200ms마다 재전송 | 단계별 듀티·점멸 | 단계별 색·소리 |
| **1초 동안 위험도 없음** ([4] 장애) | 0단계를 계속 전송, `:vision` 다시 바인딩 | 0단계 기본 점등 | 꺼짐 |
| **[2] 자체가 죽음** / 폰 전체 장애 | – | **펌웨어가 1초 뒤 스스로 0단계 기본 점등** | 펌웨어가 1초 뒤 파랑 점멸 |
| BLE 연결 끊김 | 지수 백오프로 재연결 (최대 2초 간격) | 위와 같음 | 위와 같음 |

- [2]는 `:vision` 서비스를 `BIND_AUTO_CREATE | BIND_IMPORTANT`로 바인딩해 둔다. [4]가 크래시하면 `onBindingDied`/`onServiceDisconnected`가 오고, [2]가 다시 바인딩해 `:vision`을 띄운다(Docker의 `on-failure` 역할).
- 위험도 메시지의 `ts`가 500ms보다 오래됐으면 버린다(지연된 경고 방지).
- [2]는 [5] UI와 직접 연결하지 않는다. 앱 화면이 죽어도 [2]에는 영향이 없다.

### 3.3 [3] Binder IPC (시스템의 척추)

| 항목 | 내용 |
|---|---|
| 정체 | Android 커널의 Binder 드라이버 + AIDL 인터페이스. 앱이 따로 띄우는 브로커가 없다 |
| 장점 | 앱 프로세스가 죽어도 버스 자체는 살아 있음. 호출 지연 1ms 이하 |
| 인터페이스 | `IRiskSink` ([4] → [2]), `IVisionService` ([5] → [4]: 설정·명령), `IVisionListener` ([4] → [5]·[6]: 추적·이벤트·상태) |
| 같은 프로세스 안 | Kotlin `SharedFlow` / `StateFlow` |

- 첨부 구조의 MQTT 브로커와 달리, Binder는 **"받는 쪽이 살아 있을 때만" 전달**한다. 그래서 받는 쪽이 죽었는지 알 수 있도록 `IBinder.linkToDeath()`로 상대 프로세스 사망을 감지한다.
- 실시간 경로(`onRisk`)는 `oneway`로 선언해 [4]가 [2]의 처리를 기다리지 않게 한다. 늦은 경고는 의미가 없으므로 재전송 대신 다음 프레임 값으로 덮어쓴다.

### 3.4 [4] ai-inference (`:vision` 프로세스, 죽어도 되는 구역)

| 항목 | 내용 |
|---|---|
| 엔진 | **LiteRT** (추론 엔진 보고서 결론). 가속기 우선순위: GPU 델리게이트 → NPU (Qualcomm·MediaTek) → CPU (XNNPACK) |
| 모델 | `yolo26n_416.tflite` (FP16, GPU용) / 기기에 따라 INT8 버전 |
| 파이프라인 | 프레임 → 416 리사이즈 → 검출 → 칼만+IoU 추적 → 호모그래피 거리 → TTC·CPA → 위험도 + 히스테리시스 300ms (PRD F1~F3) |
| 출력 | `onRisk()` (매 프레임 + 최소 200ms마다), 추적 목록 5Hz, 이벤트 (2단계 이상) |
| 서비스 | 포그라운드 서비스 `VisionService`, 타입 `camera`, `android:largeHeap="true"` |
| 메모리 | 약 250~400MB (모델·GPU 버퍼·프레임 포함, 가정값) |

**강등(degrade) 규칙**

| 상황 | 조치 | 상태 |
|---|---|---|
| GPU 델리게이트 초기화 실패 | NPU → CPU 순으로 대체 | `degraded` |
| 5분 안에 크래시 3회 | 다음 실행부터 CPU 모드로 고정, 기기 모델명을 기록 | `degraded` |
| 발열 여유 부족 (`getThermalHeadroom()` > 0.85) | 2프레임에 1번 검출 + 칼만 예측으로 채움 (PRD F1) | `throttled` |
| 발열 심각 (`THERMAL_STATUS_SEVERE` 이상) | 검출 중지, 0단계 유지, [5]에 "정차 후 식혀 주세요" 표시 | `paused` |

- 상태 값은 [5]에 전달돼 주행 화면 구석에 작은 아이콘으로 표시된다.

### 3.5 [5] app-ui (메인 프로세스)

| 항목 | 내용 |
|---|---|
| 언어·라이브러리 | Kotlin, Jetpack Compose |
| 화면 | ① 주행 화면 (검은 화면, 상태 아이콘만), ② 장착 보정 (IMU 각도 자동 측정 + 높이 입력), ③ 설정 (경고음, 후방 LED 밝기 상한), ④ 주행 기록·클립 조회, ⑤ 유닛 연결 (스캔·페어링) |
| 입력 | `IVisionListener` (추적·이벤트·상태) |
| 출력 | `IVisionService.setCameraConfig()` (높이·각도·내부 파라미터), 명령 (재보정 시작, 경고음 음소거) |
| 설정 저장 | Jetpack DataStore. `:vision`은 시작할 때 이 파일을 직접 읽으므로 [5]가 없어도 동작 |

- 주행 시작 버튼을 누르면 [5]가 `SafetyService`와 `VisionService`를 **화면이 보이는 상태에서** 시작한다(§1.3).
- 장착 보정(F4)은 정차 중에만 열린다. 폰을 마운트에 끼운 상태에서 IMU로 기울기를 측정하고, 장착 높이는 처음 한 번만 입력한다.

### 3.6 [6] ride-logger (메인 프로세스, 가장 먼저 버려도 되는 구역)

| 항목 | 내용 |
|---|---|
| 저장 | Room DB (`rides`, `events` 테이블), 클립 파일은 앱 전용 저장소 `clips/` |
| 입력 | `IVisionListener`의 이벤트 (시각, 차종, 최소 측면 간격, TTC, 클립 파일 이름) |
| 정리 | WorkManager로 충전 중에 오래된 클립 삭제 (앱 저장소 2GB 상한) |

- 메인 프로세스가 회수돼 [6]이 기록을 놓쳐도, 클립 파일은 [1]이 이미 저장했다. [6]은 다시 뜰 때 `clips/` 폴더를 훑어 DB에 없는 파일을 색인한다.

---

## 4. 통신 설계

### 4.1 앱 내부 메시지 (첨부 구조의 MQTT 토픽에 해당)

| 메시지 | 보내는 쪽 → 받는 쪽 | 경로 | 주기 | 내용 |
|---|---|---|---|---|
| 프레임 | [1] → [4] | Flow (같은 프로세스) | 15Hz | `ImageProxy` (복사 없음) |
| IMU | [1] → [4] | Flow | 20Hz | `{pitch, roll, ts}` (100Hz 측정값 평균) |
| **위험도** | [4] → [2] | Binder `oneway onRisk()` | 매 프레임, 최소 200ms마다 | `{level, ts, seq}` |
| 추적 목록 | [4] → [5] | Binder `IVisionListener` | 5Hz | 차종, 거리, 측면 간격, TTC |
| 위험 이벤트 | [4] → [5], [6] | Binder `IVisionListener` | 발생 시 | 이벤트 요약 + 클립 파일 이름 |
| 재보정 안내 | [1] → [5] | Binder `IVisionListener` | 발생 시 | 각도 변화량 |
| 상태 | [4], [2] → [5] | Binder | 1Hz | `running` / `degraded` / `throttled` / `paused`, BLE 연결 상태 |
| 설정·명령 | [5] → [4] | Binder `IVisionService` | 변경 시 | 높이·각도·내부 파라미터, 재보정 시작 |

### 4.2 외부 통신

| 구간 | 방식 | 담당 | 비고 |
|---|---|---|---|
| 폰 → 후방 유닛 | BLE GATT (폰 = Central) | [2] | 하드웨어 문서 §6.2 그대로. 노트북 `bleak` 역할을 [2]가 대신함 |
| 폰 → 핸들 유닛 | BLE GATT (폰 = Central) | [2] | 위와 같음. Central 1 : Peripheral 2 |
| 유닛 → 폰 (배터리) | BLE Notify | [2] → [5] | 유닛 배터리 %를 앱에 표시 |
| 앱 업데이트 | Google Play / App Store | OS | 모델 파일(`.tflite`)은 앱에 포함. 모델만 바꿀 때는 Play Feature Delivery 검토 |

---

## 5. 자원 배분 (중급 Android 기기, RAM 6GB 기준)

### 5.1 메모리와 회수 순서

Android는 메모리가 부족하면 **중요도가 낮은 프로세스부터** 회수한다(lmkd). 포그라운드 서비스를 가진 프로세스는 "사용자가 인식하는 작업"으로 분류돼 일반 백그라운드 프로세스보다 늦게 회수된다.

| 프로세스 | 구성 요소 | 예상 사용 (가정) | 중요도 | 회수 순서 |
|---|---|---|---|---|
| 메인 | [5], [6] | 약 100~150MB | 주행 화면이 보이는 동안 "포그라운드" | 화면이 꺼지거나 다른 앱으로 가면 가장 먼저 |
| `:vision` | [1], [4] | 약 300~450MB | FGS (camera) | 그다음 |
| `:safety` | [2] | 약 20~30MB | FGS (connectedDevice) | 가장 마지막 (가장 작아서 회수 이득도 적음) |

- 메모리 압박 신호(`onTrimMemory(TRIM_MEMORY_RUNNING_LOW)`)를 받으면 [4]가 먼저 클립 링버퍼를 5초로 줄인다.
- 추론 프로세스의 네이티브 메모리(GPU 버퍼)는 Java 힙 한도에 포함되지 않는다. 기기별로 실측한다(C5).

### 5.2 CPU·GPU·발열

| 자원 | 배정 |
|---|---|
| GPU / NPU | [4] 전용 |
| CPU 큰 코어 | [4] 전처리·추적 (스레드 우선순위 `THREAD_PRIORITY_DISPLAY`) |
| CPU 작은 코어 | [2] BLE, [5], [6] (기본 우선순위) |
| 영상 인코더 | [1] 클립 링버퍼 (하드웨어 인코더라 CPU 부담 거의 없음) |

- 30분 주행 시 발열로 FPS가 20% 넘게 떨어지면 안 된다(PRD 6.2). 마운트는 폰 뒷면이 바람을 받도록 설계하고, §3.4 강등 규칙으로 버틴다.
- 배터리: 카메라 + GPU 추론으로 시간당 약 15~25% 소모 예상(가정). 2시간 이상 주행은 보조배터리 연결을 안내한다.

---

## 6. AndroidManifest 초안 (첨부 구조의 docker-compose에 해당)

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-feature android:name="android.hardware.camera" android:required="true" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />

    <!-- [1] 카메라 -->
    <uses-permission android:name="android.permission.CAMERA" />
    <!-- [2] BLE (Android 12+) -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <!-- 포그라운드 서비스 (Android 14+는 타입별 권한 필요) -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application android:name=".RearGuardApp">

        <!-- [5] 메인 프로세스: 주행 화면, 설정, 보정 -->
        <activity android:name=".ui.RideActivity"
            android:screenOrientation="portrait"
            android:exported="true" />

        <!-- [2] safety-output: 가장 작고 가장 오래 사는 프로세스 -->
        <service android:name=".safety.SafetyService"
            android:process=":safety"
            android:foregroundServiceType="connectedDevice"
            android:exported="false" />

        <!-- [1] + [4]: 카메라와 추론을 한 프로세스에 가둠 -->
        <service android:name=".vision.VisionService"
            android:process=":vision"
            android:foregroundServiceType="camera"
            android:exported="false" />

    </application>
</manifest>
```

> 주의: `android:process`로 나눈 프로세스마다 `Application.onCreate()`가 따로 실행된다. 프로세스 이름을 확인해서 `:safety`에서는 BLE 외의 초기화(Room, 분석 SDK 등)를 하지 않게 한다. [2]를 작게 유지하는 핵심이다.
> 주의: `SafetyService`는 `minSdk 31`(Android 12) 이상을 기준으로 한다. BLE 권한 체계가 Android 12에서 바뀌었기 때문이다.

---

## 7. 지연 시간 예산 (PRD 목표 200ms)

| 단계 | 담당 | 예상 시간 (가정) |
|---|---|---|
| 노출·캡처 (15fps) | [1] | 약 67ms 이하 (프레임 간격) |
| 프레임 전달 (같은 프로세스 Flow) | [1] → [4] | 1ms 이하 |
| 검출 (LiteRT GPU, 416 입력, 중급 기기) | [4] | 약 15~30ms |
| 추적·거리·TTC·위험도 | [4] | 약 5ms |
| Binder `onRisk()` | [4] → [2] | 1ms 이하 |
| BLE 전송 (연결 간격 1회분) | [2] → ESP32-C3 | 약 11~15ms (HIGH 우선순위) |
| ESP32 수신 → LED·부저 | 유닛 | 1ms 이하 |
| **합계** | | **약 100~120ms (목표 200ms 안)** |

- CPU 강등 모드에서는 검출이 약 60~100ms로 늘어난다(가정). 2프레임에 1번 검출 규칙으로 15fps를 유지한다.

---

## 8. iOS에서 달라지는 점

iOS는 서드파티 앱이 **여러 프로세스로 나눌 수 없다.** 그래서 Android의 프로세스 격리를 그대로 옮길 수 없고, 한 프로세스 안에서 나눈다.

| 항목 | Android (이 문서 기준) | iOS |
|---|---|---|
| 격리 단위 | OS 프로세스 (`:safety`, `:vision`) | 한 프로세스 안의 Swift actor / 전용 DispatchQueue |
| [4]가 크래시하면 | `:vision`만 죽고 [2]가 재시작 | **앱 전체가 죽음** → ESP32 펌웨어가 1초 뒤 0단계 |
| 카메라 | FGS로 동작 | **포그라운드에서만** 동작. 주행 화면 켜 둠 + `isIdleTimerDisabled = true` |
| BLE | FGS | Background Mode `bluetooth-central` |
| 추론 엔진 | LiteRT GPU → NPU | LiteRT Metal / Core ML 델리게이트 (추론 엔진 보고서 §4) |
| 메시지 버스 | Binder + Flow | Combine / AsyncStream |

- 결론: iOS에서는 "폰 안의 두 번째 안전망([2] 분리)"이 없으므로 **ESP32 펌웨어 안전망이 유일한 안전망**이다. 그래서 펌웨어의 1초 무수신 규칙은 두 OS 모두에서 필수다.
- iOS에서도 [2]용 코드(위험도 전송·200ms 재전송·1초 타임아웃)는 추론과 다른 큐에서 돌려, 추론이 느려져도 BLE 재전송이 밀리지 않게 한다.

---

## 9. 리스크와 검증

### 9.1 리스크

| # | 리스크 | 증상 | 대응 |
|---|---|---|---|
| R1 | 제조사별 백그라운드 강제 종료 (삼성·샤오미 등의 배터리 최적화) | 주행 중 `:safety`·`:vision`이 죽음 | 주행 화면을 켜 둬 앱을 포그라운드로 유지(§1.3), 첫 실행 시 배터리 최적화 제외 설정 안내, ESP32 펌웨어 안전망 |
| R2 | LiteRT GPU·NPU 델리게이트가 특정 기기에서 크래시 | `:vision` 반복 재시작 | §3.4 강등 규칙 (3회 → CPU 고정), 기기 모델별 허용·차단 목록 |
| R3 | 화면을 꺼 둔 상태에서 `:vision` 재시작 실패 (Android 14+ 카메라 FGS 제한) | 위험도 갱신 멈춤 | 주행 중 검은 화면 유지가 기본. 화면이 꺼지면 [2]가 알림 + 핸들 유닛 파랑 점멸로 라이더에게 알림 |
| R4 | 발열 | FPS 저하, 카메라 강제 종료 | §3.4 단계별 강등, 마운트 통풍 설계 |
| R5 | 폰 배터리 방전 | 앱 전체 종료 | 20% 이하에서 [5]가 경고, 15% 이하에서 안전하게 주행 모드 종료 + 유닛은 펌웨어 0단계 |
| R6 | 진동으로 카메라 각도 변화 | 거리 추정 오차 | IMU 감시로 3° 이상 변하면 재보정 안내 (§3.1) |
| R7 | 다중 프로세스 초기화 중복 | `:safety` 메모리 증가, 시작 지연 | 프로세스 이름별 초기화 분기 (§6 주의) |

### 9.2 검증 항목

| # | 항목 | 방법 | 합격 기준 |
|---|---|---|---|
| C1 | 추론 장애 격리 | 주행 시뮬레이션 중 `adb shell kill <:vision PID>` | 1초 안에 후방 LED 0단계, `:vision` 자동 재시작 후 정상 복귀, `:safety` 재시작 0회 |
| C2 | 출력 장애 안전망 | `:safety` 프로세스 강제 종료 | 1초 안에 후방 유닛이 펌웨어 판단으로 0단계, 핸들 유닛 파랑 점멸 |
| C3 | 폰 전체 장애 | 주행 중 폰 전원 끄기 | C2와 같음 |
| C4 | 메모리 압박 | `adb shell am send-trim-memory` + 다른 무거운 앱 실행 | 메인 프로세스가 먼저 회수, `:safety`는 유지 |
| C5 | 자원 실측 | 30분 주행 영상 재생 중 `dumpsys meminfo`, 온도·FPS 기록 (중급 Android 1종 + iPhone 1종) | §5 표 갱신, FPS 저하 20% 이하 (PRD 6.2) |
| C6 | 종단 간 지연 | 240fps 촬영으로 화면 이벤트 → 후방·핸들 LED 프레임 차이 측정 | 200ms 이하 (PRD 6.2) |
| C7 | 반복 크래시 강등 | GPU 델리게이트를 일부러 실패시키는 테스트 빌드 | 3회 후 CPU 모드로 전환, 위험도 출력 유지 |

---

## 10. 정리

- **스마트폰이 곧 SBC다.** Docker는 쓸 수 없으므로 첨부 구조의 컨테이너를 Android **프로세스**로 옮겼다: `:vision`([1]+[4]), `:safety`([2]), 메인([5]+[6]), 그 사이를 OS의 **Binder**([3])가 잇는다.
- **[2] safety-output은 가장 작게:** 별도 프로세스, BLE 외 초기화 없음, 1초 무수신 시 스스로 0단계.
- **[4] ai-inference는 버려도 되게:** GPU 델리게이트 크래시가 `:vision`만 죽이고, 반복되면 CPU로 강등.
- **진짜 "절대 죽으면 안 되는 구역"은 ESP32 펌웨어다.** 폰은 통째로 죽을 수 있으므로 후방 유닛이 1초 무수신 시 스스로 기본 점등한다. iOS에서는 이것이 유일한 안전망이다.
- 수치는 설계 가정이므로 실기기에서 **C1·C2(장애 격리), C5(자원), C6(지연)** 으로 이 문서를 갱신한다.

### 참고 자료

- Android 포그라운드 서비스 타입: https://developer.android.com/develop/background-work/services/fgs/service-types
- Android 프로세스와 앱 수명 주기 (`android:process`, 메모리 회수 순서): https://developer.android.com/guide/components/activities/process-lifecycle
- AIDL / Binder: https://developer.android.com/develop/background-work/services/aidl
- Android 발열 API (`getThermalHeadroom`): https://developer.android.com/games/optimize/adpf/thermal
- LiteRT (Android): https://ai.google.dev/edge/litert/android
- iOS 백그라운드 BLE (`bluetooth-central`): https://developer.apple.com/documentation/corebluetooth
- 하드웨어 문서: `hardware_parts_design.md` §3.3(후방 LED 단계·연결 끊김 규칙), §6.2(BLE 설계)
- 추론 엔진 문서: `inference_engine_selection.md` (LiteRT 채택 근거)

> 참고: Android 버전별 포그라운드 서비스 제한은 자주 바뀐다. 개발 시작 시점의 최신 문서로 다시 확인한다.
