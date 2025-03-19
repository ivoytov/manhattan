using DotEnv

DotEnv.load()
@show haskey(ENV, "WSS")