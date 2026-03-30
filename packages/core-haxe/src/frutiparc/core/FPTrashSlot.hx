package frutiparc.core;

/**
 * Portage Haxe du module frutiparc/FPTrashSlot.as.
 */
class FPTrashSlot extends Slot {
  public function new() {
    super();
    this.title = "trash";
  }

  override public function addBox(box:Dynamic):Void {
    box.mode = "trash";
    super.addBox(box);
  }
}
