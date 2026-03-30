package frutiparc.core;

/**
 * Portage Haxe pragmatique du module AS2 WinStandard.
 * Focus: logique non-Flash (mode desktop/tab, recal, size/pos, titre, gelatine).
 */
class WinStandard extends Window {
  public static var env:Dynamic = {
    frameMode: false,
    mcw: 800,
    mch: 600,
    cornerX: 0,
    cornerY: 0,
    tmod: 1,
  };

  public var pos:Dynamic;
  public var minimum:Dynamic;
  public var tab:Dynamic;
  public var box:Dynamic;
  public var title:String;
  public var gel:Float = 0;
  public var flResizable:Bool;
  public var flMoveAnim:Bool;
  public var flInterface:Bool;
  public var xScale:Float = 100;
  public var yScale:Float = 100;
  public var xPos:Float = 0;
  public var yPos:Float = 0;

  public function new() {
    super();
    this.pos = {x: 0, y: 0, w: 0, h: 0};
    this.minimum = {w: 0, h: 0};
    this.tab = {w: 0, h: 0};
    this.box = {mode: "desktop"};
  }

  override public function init():Void {
    if (this.flInterface == null) this.flInterface = true;
    super.init();
    if (this.flResizable == null) this.flResizable = true;
    if (this.flMoveAnim == null) this.flMoveAnim = true;
  }

  public function update():Void {
    updateSize();
    updatePos();
  }

  public function updatePos():Void {
    if (this.box.mode == "desktop") updateDeskPos();
    else if (this.box.mode == "tab") updateTabPos();
  }

  public function updateSize():Void {
    if (this.box.mode == "desktop") updateDeskSize();
    else if (this.box.mode == "tab") updateTabSize();
  }

  public function updateDeskPos():Void {
    recal();
    moveToPos();
  }

  public function moveToPos():Void {
    this.xPos = this.pos.x;
    this.yPos = this.pos.y;
  }

  public function updateDeskSize():Void {
    this.minimum.w = Math.max(0, this.minimum.w);
    this.minimum.h = Math.max(0, this.minimum.h);
  }

  public function updateTabPos():Void {
    this.xPos = env.cornerX;
    this.yPos = env.cornerY;
  }

  public function updateTabSize():Void {
    this.tab.w = env.mcw - env.cornerX;
    this.tab.h = env.mch - env.cornerY;
  }

  public function recal():Bool {
    if (env.frameMode) return false;

    var oldPos = {x: this.pos.x, y: this.pos.y, w: this.pos.w, h: this.pos.h};

    this.pos.w = Math.max(Math.min(env.mcw - env.cornerX, this.pos.w), this.minimum.w);
    this.pos.h = Math.max(Math.min(env.mch - env.cornerY, this.pos.h), this.minimum.h);
    this.pos.x = Math.max(Math.min(this.pos.x, env.mcw - this.pos.w), env.cornerX);
    this.pos.y = Math.max(Math.min(this.pos.y, env.mch - this.pos.h), env.cornerY);

    return oldPos.x != this.pos.x || oldPos.y != this.pos.y || oldPos.w != this.pos.w || oldPos.h != this.pos.h;
  }

  public function resize(w:Float, h:Float):Void {
    this.pos.w = w;
    this.pos.h = h;
    recal();
    update();
  }

  public function onChangeMode():Void {
    if (this.box.mode == "desktop") initDesktopMode();
    else initTabMode();
    update();
  }

  public function initDesktopMode():Void {}

  public function initTabMode():Void {}

  public function onStageResize():Void {
    update();
  }

  public function setTitle(title:String):Void {
    this.title = title;
  }

  public function gelatine():Void {
    this.gel = (this.gel + env.tmod * 10) % 628;
    this.xScale = 100 + Math.cos(this.gel / 100) * 4;
    this.yScale = 100 + Math.sin(this.gel / 100) * 4;
  }
}
