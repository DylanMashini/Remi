import ExpoModulesCore

public final class GlassesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Glasses")

    Events("onStatus")

    Function("hello") {
      return "Hello from Swift"
    }

    AsyncFunction("getStatus") { () -> [String: String] in
      return ["connection": "disconnected"]
    }
  }
}
