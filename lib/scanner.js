const EventEmitter = require("events");
const noble = require("@stoprocent/noble");
const { Parser, EventTypes, SERVICE_DATA_UUID } = require("./parser");

class Scanner extends EventEmitter {
  constructor(address, options) {
    super();
    options = options || {};
    const {
      log = console,
      forceDiscovering = true,
      restartDelay = 600 * 1000,
      bindKey = null,
      discoverInterval,
    } = options;
    this.log = log;
    this.address = address;
    this.forceDiscovering = forceDiscovering;
    this.restartDelay = restartDelay;
    this.bindKey = bindKey;
    this.discoverInterval = discoverInterval;
    this.scanning = false;
    this.configure();
  }

  configure() {
    noble.on("discover", this.onDiscover.bind(this));
    noble.on("scanStart", this.onScanStart.bind(this));
    noble.on("scanStop", this.onScanStop.bind(this));
    noble.on("warning", this.onWarning.bind(this));
    noble.on("stateChange", this.onStateChange);
  }

  start = async () => {
    this.log.debug("Start scanning.");
    try {
      noble.startScanning([], true);
      await new Promise((resolve) => {
        setTimeout(() => {
          noble.stopScanning();
          this.log.debug(
            `[BLE] Scan complete. after scanTime: ${
              this.discoverInterval / 1000
            }s`
          );
          resolve(null);
        }, this.discoverInterval);
      });
      this.scanning = true;
    } catch (e) {
      this.scanning = false;
      this.log.error(e);
    }
  };

  stop() {
    this.scanning = false;
    noble.stopScanning();
  }

  onStateChange = async (state) => {
    if (state === "poweredOn") {
      await this.start();
    } else {
      this.log.info(`Stop scanning. (${state})`);
      this.stop();
    }
  };

  onWarning(message) {
    this.log.info("Warning: ", message);
  }

  onScanStart() {
    this.log.debug("Started scanning.");
  }

  onScanStop = async () => {
    this.log.debug("Stopped scanning.");
    // We are scanning but something stopped it. Restart scan.
    if (this.scanning && this.forceDiscovering) {
      setTimeout(async () => {
        this.log.debug("Restarting scan.");
        await this.start();
      }, this.restartDelay);
    }
  };

  onDiscover(peripheral) {
    const {
      advertisement: { serviceData } = {},
      id,
      address,
    } = peripheral || {};

    if (!this.isValidAddress(address) && !this.isValidAddress(id)) {
      return;
    }

    const miServiceData = this.getValidServiceData(serviceData);
    if (!miServiceData) {
      return;
    }

    this.logPeripheral({ peripheral, serviceData: miServiceData });

    const result = this.parseServiceData(miServiceData.data);
    if (result == null) {
      return;
    }

    if (!result.frameControl.hasEvent) {
      this.log.debug("No event");
      return;
    }

    const { eventType, event } = result;
    switch (eventType) {
      case EventTypes.temperature: {
        const { temperature } = event;
        this.emit("temperatureChange", temperature, { id, address });
        break;
      }
      case EventTypes.humidity: {
        const { humidity } = event;
        this.emit("humidityChange", humidity, { id, address });
        break;
      }
      case EventTypes.battery: {
        const { battery } = event;
        this.emit("batteryChange", battery, { id, address });
        break;
      }
      case EventTypes.temperatureAndHumidity: {
        const { temperature, humidity } = event;
        this.emit("temperatureChange", temperature, { id, address });
        this.emit("humidityChange", humidity, { id, address });
        break;
      }
      case EventTypes.illuminance: {
        const { illuminance } = event;
        this.emit("illuminanceChange", illuminance, { id, address });
        break;
      }
      case EventTypes.moisture: {
        const { moisture } = event;
        this.emit("moistureChange", moisture, { id, address });
        break;
      }
      case EventTypes.fertility: {
        const { fertility } = event;
        this.emit("fertilityChange", fertility, { id, address });
        break;
      }
      default: {
        this.emit("error", new Error(`Unknown event type ${eventType}`));
        return;
      }
    }
    this.emit("change", event, { id, address });
  }

  cleanAddress(address) {
    if (address == null) {
      return address;
    }
    return address.toLowerCase().replace(/[:-]/g, "");
  }

  isValidAddress(address) {
    return (
      this.address == null ||
      this.cleanAddress(this.address) === this.cleanAddress(address)
    );
  }

  getValidServiceData(serviceData) {
    return (
      serviceData &&
      serviceData.find((data) => data.uuid.toLowerCase() === SERVICE_DATA_UUID)
    );
  }

  parseServiceData(serviceData) {
    try {
      return new Parser(serviceData, this.bindKey).parse();
    } catch (error) {
      this.emit("error", error);
    }
  }

  logPeripheral({
    peripheral: {
      address,
      id,
      rssi,
      advertisement: { localName },
    },
    serviceData,
  }) {
    this.log.debug(`[${address || id}] Discovered peripheral
      Id: ${id}
      LocalName: ${localName}
      rssi: ${rssi}
      serviceData: ${serviceData.data.toString("hex")}`);
  }
}

module.exports = { Scanner };
