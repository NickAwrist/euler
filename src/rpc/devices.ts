import type { ServiceImpl } from "@connectrpc/connect";
import { deleteDevice, saveDevice } from "../db/devices";
import {
  ApnsEnvironment,
  type DeviceService,
} from "../gen/euler/v1/devices_pb";
import { ownerOf } from "./context";

export const deviceService: ServiceImpl<typeof DeviceService> = {
  registerDevice(request, context) {
    saveDevice({
      token: request.token,
      owner_uuid: ownerOf(context),
      environment:
        request.environment === ApnsEnvironment.PRODUCTION
          ? "production"
          : "sandbox",
      bundle_id: request.bundleId,
    });
    return {};
  },
  unregisterDevice(request, context) {
    deleteDevice(ownerOf(context), request.token);
    return {};
  },
};
