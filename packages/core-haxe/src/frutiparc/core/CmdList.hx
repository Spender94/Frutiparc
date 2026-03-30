package frutiparc.core;

/**
 * Portage Haxe du module global frutiparc/cmdList.as.
 */
class CmdList {
  public static function create(?overrides:Dynamic):Dynamic {
    var base:Dynamic = {
      error: "a",
      serviceinfo: "b",
      time: "c",
      ip: "d",
      ping: "e",
      ident: "k"
    };

    if (overrides != null) {
      for (field in Reflect.fields(overrides)) {
        Reflect.setField(base, field, Reflect.field(overrides, field));
      }
    }

    return base;
  }
}
