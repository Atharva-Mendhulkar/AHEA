/**
 * Frozen AHEA reference harness. Coordinates are in the 1500 × 900 SVG viewBox.
 * ESP32-S3 header names follow Espressif ESP32-S3-DevKitC-1 v1.1 J1/J3.
 */

const leftHeader = ["3V3-1", "3V3-2", "RST", "GPIO4", "GPIO5", "GPIO6", "GPIO7", "GPIO15", "GPIO16", "GPIO17", "GPIO18", "GPIO8", "GPIO3", "GPIO46", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "5V", "GND-J1"];
const rightHeader = ["GND-J3-1", "TX43", "RX44", "GPIO1", "GPIO2", "GPIO42", "GPIO41", "GPIO40", "GPIO39", "GPIO38", "GPIO37", "GPIO36", "GPIO35", "GPIO0", "GPIO45", "GPIO48", "GPIO47", "GPIO21", "GPIO20", "GPIO19", "GND-J3-21", "GND-J3-22"];
const usedEspPins = new Set(["3V3-1", "GND-J1", "GPIO4", "GPIO5", "GPIO6", "GPIO7", "GPIO8", "GPIO9", "GPIO15", "GPIO16", "GND-J3-1"]);

const espPins = [
  ...leftHeader.map((id, index) => ({ id, label: id.replace("GPIO", "IO"), header: `J1-${index + 1}`, x: 648, y: 298 + index * 12, used: usedEspPins.has(id) })),
  ...rightHeader.map((id, index) => ({ id, label: id.replace("GPIO", "IO"), header: `J3-${index + 1}`, x: 852, y: 298 + index * 12, used: usedEspPins.has(id) })),
];

export const components = [
  { id: "esp32", name: "ESP32-S3-DevKitC-1 v1.1", part: "ESP32-S3-WROOM-1 · 44-pin", purpose: "Primary 3.3 V controller", step: 0, x: 648, y: 275, w: 204, h: 292, pins: espPins },
  { id: "supply", name: "Regulated bench adapter", part: "5 V / 3 A", purpose: "Independent actuator and 5 V sensor supply", step: 1, x: 42, y: 274, w: 118, h: 88, pins: [
    { id: "+5V", label: "+5V", x: 160, y: 302, used: true }, { id: "GND", label: "GND", x: 160, y: 342, used: true },
  ] },
  { id: "mpu6050", name: "MPU6050 motion sensor", part: "GY-521", purpose: "3-axis acceleration and angular-rate sensing over I²C", step: 2, asset: "/assets/fritzing/mpu6050-gy521.svg", x: 240, y: 35, w: 185, h: 125, pins: [
    ["VCC", 258], ["GND", 280], ["SCL", 302], ["SDA", 324], ["XDA", 346], ["XCL", 368], ["AD0", 390], ["INT", 412],
  ].map(([id, x]) => ({ id, label: id, x, y: 166, used: ["VCC", "GND", "SCL", "SDA", "AD0"].includes(id) })) },
  { id: "dht11", name: "DHT11", part: "Bare 4-pin package", purpose: "Temperature and humidity sensing", step: 2, x: 78, y: 665, w: 132, h: 120, pins: [
    ["VCC", 95], ["DATA", 125], ["NC", 155], ["GND", 185],
  ].map(([id, x]) => ({ id, label: id, x, y: 790, used: id !== "NC" })) },
  { id: "hcsr04", name: "HC-SR04 ultrasonic sensor", part: "HC-SR04", purpose: "5 V ranging; ECHO reduced to 3.0 V", step: 3, asset: "/assets/fritzing/hc-sr04.svg", x: 455, y: 28, w: 230, h: 132, pins: [
    ["VCC", 485], ["TRIG", 540], ["ECHO", 595], ["GND", 650],
  ].map(([id, x]) => ({ id, label: id, x, y: 166, used: true })) },
  { id: "acs712", name: "ACS712 current sensor", part: "ACS712-05B", purpose: "Measures downstream 5 V load current", step: 4, asset: "/assets/fritzing/acs712.svg", x: 1065, y: 35, w: 205, h: 132, pins: [
    { id: "IP+", label: "IP+", x: 1087, y: 78, used: true }, { id: "IP-", label: "IP−", x: 1087, y: 130, used: true },
    { id: "5V", label: "5V", x: 1184, y: 170, used: true }, { id: "VO", label: "VO", x: 1218, y: 170, used: true }, { id: "GND", label: "GND", x: 1252, y: 170, used: true },
  ] },
  { id: "voltage", name: "Voltage sensor", part: "0–25 V passive divider module", purpose: "Monitors the downstream 5 V rail", step: 4, x: 1068, y: 690, w: 208, h: 116, pins: [
    { id: "VIN+", label: "VIN+", x: 1085, y: 712, used: true }, { id: "VIN-", label: "VIN−", x: 1085, y: 762, used: true },
    { id: "S", label: "S", x: 1188, y: 812, used: true }, { id: "+", label: "+", x: 1222, y: 812, used: false }, { id: "-", label: "−", x: 1256, y: 812, used: true },
  ] },
  { id: "sg90", name: "SG90 micro servo", part: "TowerPro SG90 9 g", purpose: "PWM-controlled actuator on independent 5 V rail", step: 5, asset: "/assets/fritzing/sg90-equivalent.svg", x: 1290, y: 625, w: 170, h: 155, pins: [
    { id: "GND", label: "GND · brown", x: 1302, y: 794, used: true }, { id: "5V", label: "5V · red", x: 1368, y: 794, used: true }, { id: "PWM", label: "PWM · orange", x: 1434, y: 794, used: true },
  ] },
  { id: "r_dht", name: "DHT pull-up resistor", part: "10 kΩ · ¼ W", purpose: "Holds DHT11 DATA high", step: 2, x: 274, y: 714, w: 70, h: 22, pins: [{ id: "1", label: "1", x: 274, y: 725, used: true }, { id: "2", label: "2", x: 344, y: 725, used: true }] },
  { id: "r_echo_hi", name: "ECHO divider upper", part: "2.2 kΩ · ¼ W", purpose: "First leg of 5 V to 3.0 V divider", step: 3, x: 940, y: 222, w: 74, h: 22, pins: [{ id: "1", label: "1", x: 940, y: 233, used: true }, { id: "2", label: "2", x: 1014, y: 233, used: true }] },
  { id: "r_echo_lo", name: "ECHO divider lower", part: "3.3 kΩ · ¼ W", purpose: "Divider return to ground", step: 3, x: 1014, y: 248, w: 74, h: 22, pins: [{ id: "1", label: "1", x: 1014, y: 259, used: true }, { id: "2", label: "2", x: 1088, y: 259, used: true }] },
  { id: "r_acs_hi", name: "ACS712 ADC divider upper", part: "12 kΩ · ¼ W", purpose: "Limits ACS712 VO at ESP32 ADC", step: 4, x: 940, y: 582, w: 74, h: 22, pins: [{ id: "1", label: "1", x: 940, y: 593, used: true }, { id: "2", label: "2", x: 1014, y: 593, used: true }] },
  { id: "r_acs_lo", name: "ACS712 ADC divider lower", part: "18 kΩ · ¼ W", purpose: "ADC divider return", step: 4, x: 1014, y: 610, w: 74, h: 22, pins: [{ id: "1", label: "1", x: 1014, y: 621, used: true }, { id: "2", label: "2", x: 1088, y: 621, used: true }] },
  { id: "r_servo", name: "Servo signal resistor", part: "220 Ω · ¼ W", purpose: "Limits PWM edge current", step: 5, x: 1150, y: 850, w: 74, h: 22, pins: [{ id: "1", label: "1", x: 1150, y: 861, used: true }, { id: "2", label: "2", x: 1224, y: 861, used: true }] },
  { id: "c_servo_bulk", name: "Servo bulk capacitor", part: "470 µF · 10 V electrolytic", purpose: "Buffers servo current steps", step: 5, x: 1260, y: 500, w: 34, h: 62, pins: [{ id: "+", label: "+", x: 1268, y: 568, used: true }, { id: "-", label: "−", x: 1288, y: 568, used: true }] },
  { id: "c_servo_dec", name: "Servo bypass capacitor", part: "100 nF ceramic", purpose: "High-frequency servo decoupling", step: 5, x: 1310, y: 535, w: 44, h: 28, pins: [{ id: "1", label: "1", x: 1310, y: 568, used: true }, { id: "2", label: "2", x: 1354, y: 568, used: true }] },
  { id: "c_acs", name: "ACS712 ADC filter", part: "100 nF ceramic", purpose: "Filters conditioned current signal", step: 4, x: 1048, y: 650, w: 44, h: 28, pins: [{ id: "1", label: "1", x: 1048, y: 684, used: true }, { id: "2", label: "2", x: 1092, y: 684, used: true }] },
  { id: "c_voltage", name: "Voltage ADC filter", part: "100 nF ceramic", purpose: "Filters scaled voltage signal", step: 4, x: 975, y: 760, w: 44, h: 28, pins: [{ id: "1", label: "1", x: 975, y: 794, used: true }, { id: "2", label: "2", x: 1019, y: 794, used: true }] },
  { id: "d_acs_hi", name: "Upper ADC clamp", part: "1N5817 Schottky", purpose: "Clamps ADC node toward 3.3 V", step: 4, x: 905, y: 640, w: 65, h: 22, pins: [{ id: "A", label: "A", x: 905, y: 651, used: true }, { id: "K", label: "K", x: 970, y: 651, used: true }] },
  { id: "d_acs_lo", name: "Lower ADC clamp", part: "1N5817 Schottky", purpose: "Clamps ADC node below ground", step: 4, x: 905, y: 675, w: 65, h: 22, pins: [{ id: "A", label: "A", x: 905, y: 686, used: true }, { id: "K", label: "K", x: 970, y: 686, used: true }] },
];

export const gpioAssignments = [
  ["ACS712 conditioned output", "GPIO4", "ADC1_CH3"], ["Voltage sensor output", "GPIO5", "ADC1_CH4"], ["DHT11 DATA", "GPIO6", "Digital"],
  ["HC-SR04 TRIG", "GPIO7", "Digital out"], ["MPU6050 SDA", "GPIO8", "I²C SDA"], ["MPU6050 SCL", "GPIO9", "I²C SCL"],
  ["HC-SR04 divided ECHO", "GPIO15", "Digital in"], ["SG90 PWM", "GPIO16", "PWM out"],
].map(([signal, pin, capability]) => ({ signal, pin, capability }));

const W = (id, step, net, from, to, voltage, signal, route, direction = "bidirectional") => ({ id, step, net, from, to, voltage, signal, route, direction });
export const wires = [
  W("w01", 1, "EXT_5V_RAW", "supply.+5V", "acs712.IP+", "5 V", "power", [[160,302],[190,302],[190,90],[1087,90],[1087,78]], "out"),
  W("w02", 1, "EXT_GND", "supply.GND", "hole.T-4", "0 V", "ground", [[160,342],[202,342],[202,198],[250,198]], "out"),
  W("w03", 1, "COMMON_GND", "hole.T-5", "esp32.GND-J1", "0 V", "ground", [[265,198],[632,198],[632,550],[648,550]], "bidirectional"),
  W("w04", 1, "LOAD_5V", "acs712.IP-", "hole.T+42", "5 V", "power", [[1087,130],[1040,130],[1040,184],[820,184]], "out"),
  W("w05", 1, "EXT_GND", "hole.T-25", "hole.T-26", "0 V", "rail bridge", [[565,198],[580,198]], "bidirectional"),
  W("w06", 1, "LOAD_5V", "hole.T+25", "hole.T+26", "5 V", "rail bridge", [[565,184],[580,184]], "out"),
  W("w07", 1, "EXT_GND", "hole.T-50", "hole.B-50", "0 V", "rail bridge", [[940,198],[940,706]], "bidirectional"),
  W("w08", 1, "LOAD_5V", "hole.T+50", "hole.B+50", "5 V", "rail bridge", [[940,184],[925,184],[925,692],[940,692]], "out"),
  W("w09", 2, "3V3", "esp32.3V3-1", "mpu6050.VCC", "3.3 V", "power", [[648,298],[620,298],[620,178],[258,178],[258,166]], "out"),
  W("w10", 2, "COMMON_GND", "mpu6050.GND", "hole.T-12", "0 V", "ground", [[280,166],[280,198],[370,198]], "out"),
  W("w11", 2, "I2C_SDA", "esp32.GPIO8", "mpu6050.SDA", "3.3 V", "I²C SDA", [[648,430],[600,430],[600,214],[324,214],[324,166]], "bidirectional"),
  W("w12", 2, "I2C_SCL", "esp32.GPIO9", "mpu6050.SCL", "3.3 V", "I²C SCL", [[648,466],[580,466],[580,226],[302,226],[302,166]], "out"),
  W("w13", 2, "MPU_AD0", "mpu6050.AD0", "hole.T-14", "0 V", "address select", [[390,166],[390,198],[400,198]], "out"),
  W("w14", 2, "3V3", "esp32.3V3-1", "dht11.VCC", "3.3 V", "power", [[648,298],[620,298],[620,650],[95,650],[95,790]], "out"),
  W("w15", 2, "COMMON_GND", "dht11.GND", "hole.B-8", "0 V", "ground", [[185,790],[185,706],[310,706]], "out"),
  W("w16", 2, "DHT_DATA", "dht11.DATA", "r_dht.1", "3.3 V", "1-wire data", [[125,790],[125,725],[274,725]], "bidirectional"),
  W("w17", 2, "DHT_DATA", "r_dht.1", "esp32.GPIO6", "3.3 V", "digital", [[274,725],[360,725],[360,620],[610,620],[610,358],[648,358]], "bidirectional"),
  W("w18", 2, "3V3", "r_dht.2", "esp32.3V3-1", "3.3 V", "pull-up", [[344,725],[620,725],[620,298],[648,298]], "out"),
  W("w19", 3, "LOAD_5V", "hole.T+30", "hcsr04.VCC", "5 V", "power", [[640,184],[485,184],[485,166]], "out"),
  W("w20", 3, "COMMON_GND", "hcsr04.GND", "hole.T-31", "0 V", "ground", [[650,166],[650,184],[655,184],[655,198]], "out"),
  W("w21", 3, "US_TRIG", "esp32.GPIO7", "hcsr04.TRIG", "3.3 V", "digital out", [[648,370],[560,370],[560,190],[540,190],[540,166]], "out"),
  W("w22", 3, "US_ECHO_5V", "hcsr04.ECHO", "r_echo_hi.1", "5 V", "digital in", [[595,166],[595,233],[940,233]], "out"),
  W("w23", 3, "US_ECHO_3V", "r_echo_hi.2", "esp32.GPIO15", "3.0 V max", "divided digital in", [[1014,233],[1014,280],[900,280],[900,244],[620,244],[620,382],[648,382]], "out"),
  W("w24", 3, "US_ECHO_3V", "r_echo_hi.2", "r_echo_lo.1", "3.0 V max", "divider junction", [[1014,233],[1014,259]], "out"),
  W("w25", 3, "COMMON_GND", "r_echo_lo.2", "hole.T-60", "0 V", "ground", [[1088,259],[1090,198]], "out"),
  W("w26", 4, "LOAD_5V", "hole.T+56", "acs712.5V", "5 V", "power", [[1030,184],[1030,190],[1184,190],[1184,170]], "out"),
  W("w27", 4, "COMMON_GND", "acs712.GND", "hole.T-58", "0 V", "ground", [[1252,170],[1252,198],[1060,198]], "out"),
  W("w28", 4, "ACS_RAW", "acs712.VO", "r_acs_hi.1", "0–5 V", "analog", [[1218,170],[1218,593],[940,593]], "out"),
  W("w29", 4, "ACS_ADC", "r_acs_hi.2", "esp32.GPIO4", "0–3.0 V", "ADC1_CH3", [[1014,593],[880,593],[880,610],[610,610],[610,334],[648,334]], "out"),
  W("w30", 4, "ACS_ADC", "r_acs_hi.2", "r_acs_lo.1", "0–3.0 V", "divider junction", [[1014,593],[1014,621]], "out"),
  W("w31", 4, "COMMON_GND", "r_acs_lo.2", "hole.B-58", "0 V", "ground", [[1088,621],[1088,706],[1060,706]], "out"),
  W("w32", 4, "ACS_ADC", "c_acs.1", "r_acs_hi.2", "0–3.0 V", "filter", [[1048,684],[1048,593],[1014,593]], "bidirectional"),
  W("w33", 4, "COMMON_GND", "c_acs.2", "hole.B-60", "0 V", "ground", [[1092,684],[1092,696],[1090,696],[1090,706]], "out"),
  W("w34", 4, "ACS_ADC", "d_acs_hi.A", "r_acs_hi.2", "0–3.0 V", "upper clamp anode", [[905,651],[890,651],[890,593],[1014,593]], "out"),
  W("w35", 4, "3V3", "d_acs_hi.K", "esp32.3V3-1", "3.3 V", "upper clamp cathode", [[970,651],[970,580],[620,580],[620,298],[648,298]], "out"),
  W("w36", 4, "COMMON_GND", "d_acs_lo.A", "hole.B-42", "0 V", "lower clamp anode", [[905,686],[820,686],[820,706]], "out"),
  W("w37", 4, "ACS_ADC", "d_acs_lo.K", "r_acs_hi.2", "0–3.0 V", "lower clamp cathode", [[970,686],[985,686],[985,593],[1014,593]], "out"),
  W("w38", 4, "LOAD_5V", "voltage.VIN+", "hole.B+55", "5 V", "measured input", [[1085,712],[1085,692],[1015,692]], "in"),
  W("w39", 4, "COMMON_GND", "voltage.VIN-", "hole.B-55", "0 V", "measured return", [[1085,762],[1040,762],[1040,706],[1015,706]], "in"),
  W("w40", 4, "VOLT_ADC", "voltage.S", "esp32.GPIO5", "0–1.5 V at 5 V input", "ADC1_CH4", [[1188,812],[1120,812],[1120,625],[590,625],[590,346],[648,346]], "out"),
  W("w41", 4, "COMMON_GND", "voltage.-", "hole.B-61", "0 V", "ground", [[1256,812],[1105,812],[1105,706]], "out"),
  W("w42", 4, "VOLT_ADC", "c_voltage.1", "voltage.S", "0–1.5 V", "filter", [[975,794],[975,812],[1188,812]], "bidirectional"),
  W("w43", 4, "COMMON_GND", "c_voltage.2", "hole.B-47", "0 V", "ground", [[1019,794],[1019,706],[895,706]], "out"),
  W("w44", 5, "LOAD_5V", "sg90.5V", "hole.B+61", "5 V", "servo power", [[1368,794],[1368,692],[1105,692]], "in"),
  W("w45", 5, "COMMON_GND", "sg90.GND", "hole.B-62", "0 V", "servo return", [[1302,794],[1302,706],[1120,706]], "out"),
  W("w46", 5, "SERVO_PWM", "esp32.GPIO16", "r_servo.1", "3.3 V", "50 Hz PWM", [[648,394],[590,394],[590,861],[1150,861]], "out"),
  W("w47", 5, "SERVO_PWM", "r_servo.2", "sg90.PWM", "3.3 V", "50 Hz PWM", [[1224,861],[1434,861],[1434,794]], "out"),
  W("w48", 5, "LOAD_5V", "c_servo_bulk.+", "hole.B+63", "5 V", "bulk decoupling +", [[1268,568],[1135,568],[1135,692]], "in"),
  W("w49", 5, "COMMON_GND", "c_servo_bulk.-", "hole.B-63", "0 V", "bulk decoupling −", [[1288,568],[1150,568],[1150,695],[1135,695],[1135,706]], "out"),
  W("w50", 5, "LOAD_5V", "c_servo_dec.1", "hole.B+59", "5 V", "local bypass", [[1310,568],[1075,568],[1075,692]], "in"),
  W("w51", 5, "COMMON_GND", "c_servo_dec.2", "hole.B-59", "0 V", "local bypass", [[1354,568],[1165,568],[1165,680],[1075,680],[1075,706]], "out"),
];

export const assemblySteps = [
  { id: "base", title: "ESP32 + breadboard", detail: "Controller positioned; all 44 header pins exposed", placementMs: 650 },
  { id: "power", title: "Power distribution", detail: "5 V load rail and common ground", placementMs: 520 },
  { id: "environment", title: "Motion + environment", detail: "MPU6050 and bare DHT11", placementMs: 620 },
  { id: "distance", title: "Ultrasonic ranging", detail: "HC-SR04 ECHO divided to 3.0 V", placementMs: 600 },
  { id: "analog", title: "Analog monitoring", detail: "ACS712 + voltage sensing conditioned", placementMs: 650 },
  { id: "actuation", title: "Servo + verification", detail: "SG90 independently powered and verified", placementMs: 650 },
];

export const cameraViews = [
  { id: "full", label: "Full circuit", viewBox: "0 0 1500 900" },
  { id: "esp32", label: "ESP32 pins", viewBox: "555 245 390 360" },
  { id: "power", label: "Power", viewBox: "20 145 1160 620" },
  { id: "sensors", label: "Sensors", viewBox: "190 0 1100 710" },
  { id: "actuation", label: "Actuation", viewBox: "545 475 940 420" },
  { id: "topology", label: "Breadboard", viewBox: "155 165 1165 585" },
];

export function endpoint(ref) {
  const [componentId, pinId] = ref.split(".");
  if (componentId === "hole") return { kind: "hole", componentId, pinId };
  const component = components.find((item) => item.id === componentId);
  const pin = component?.pins.find((item) => item.id === pinId);
  return component && pin ? { kind: "pin", componentId, component, pinId, pin } : null;
}

function holePosition(id) {
  const rail = id.match(/^([TB])([+-])(\d+)$/);
  if (rail && Number(rail[3]) >= 1 && Number(rail[3]) <= 63) return { x: 190 + Number(rail[3]) * 15, y: rail[1] === "T" ? (rail[2] === "+" ? 184 : 198) : (rail[2] === "+" ? 692 : 706) };
  const strip = id.match(/^([A-J])(\d+)$/);
  if (!strip || Number(strip[2]) < 1 || Number(strip[2]) > 63) return null;
  const rowIndex = "ABCDE".includes(strip[1]) ? "ABCDE".indexOf(strip[1]) : "FGHIJ".indexOf(strip[1]) + 5;
  return { x: 190 + Number(strip[2]) * 15, y: 255 + rowIndex * 38 + (rowIndex >= 5 ? 28 : 0) };
}

export function validateCircuit() {
  const errors = [];
  const occupiedHoles = new Map();
  const gpioPins = gpioAssignments.map((item) => item.pin);
  if (new Set(gpioPins).size !== gpioPins.length) errors.push("GPIO allocation contains a duplicate pin.");
  for (const wire of wires) {
    for (const [index, ref] of [wire.from, wire.to].entries()) {
      const target = ref.startsWith("hole.") ? holePosition(ref.slice(5)) : endpoint(ref)?.pin;
      if (ref.startsWith("hole.")) {
        if (occupiedHoles.has(ref)) errors.push(`${wire.id}: ${ref} is already occupied by ${occupiedHoles.get(ref)}`);
        occupiedHoles.set(ref, wire.id);
      }
      if (!target) errors.push(`${wire.id}: unknown endpoint ${ref}`);
      else {
        const point = index === 0 ? wire.route[0] : wire.route.at(-1);
        if (point[0] !== target.x || point[1] !== target.y) errors.push(`${wire.id}: drawn endpoint does not land on ${ref}`);
      }
    }
    if (/esp32\.GPIO/.test(wire.to) && Number.parseFloat(wire.voltage) > 3.3) errors.push(`${wire.id}: unsafe ESP32 input voltage ${wire.voltage}`);
    if (wire.route.length < 2) errors.push(`${wire.id}: route is not physically drawable.`);
  }
  for (const component of components.filter((item) => /^(r_|c_|d_)/.test(item.id))) {
    for (const pin of component.pins) {
      if (!wires.some((wire) => wire.from === `${component.id}.${pin.id}` || wire.to === `${component.id}.${pin.id}`)) errors.push(`${component.id}.${pin.id} is floating.`);
    }
  }
  const expectedDiodes = { d_acs_hi: ["A", "K"], d_acs_lo: ["A", "K"] };
  for (const [id, pins] of Object.entries(expectedDiodes)) if (!pins.every((pin) => endpoint(`${id}.${pin}`))) errors.push(`${id}: diode polarity is undefined.`);
  return { valid: errors.length === 0, errors, checked: { components: components.length, pins: components.reduce((sum, item) => sum + item.pins.length, 0), wires: wires.length, gpio: gpioAssignments.length } };
}

export function connectedPinRows() {
  return wires.map((wire) => ({
    component: wire.from.startsWith("hole.") ? "Breadboard" : endpoint(wire.from)?.component.name,
    physicalPin: wire.from.startsWith("hole.") ? wire.from.slice(5) : `${endpoint(wire.from)?.pin.label} (${endpoint(wire.from)?.pin.header || endpoint(wire.from)?.pin.id})`,
    function: wire.signal,
    connectsTo: wire.to.startsWith("hole.") ? `Breadboard ${wire.to.slice(5)}` : `${endpoint(wire.to)?.component.name} · ${endpoint(wire.to)?.pin.label}`,
    voltage: wire.voltage,
    signalType: wire.direction,
    wireId: wire.id,
  }));
}
