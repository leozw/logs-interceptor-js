export const LOKI_PROTO = `
syntax = "proto3";
package logproto;

// import "google/protobuf/timestamp.proto"; /** REMOVED: Inlined to avoid resolution issues in diverse environments */

message PushRequest {
  repeated StreamAdapter streams = 1;
}

message StreamAdapter {
  string labels = 1;
  repeated EntryAdapter entries = 2;
}

message EntryAdapter {
  Timestamp timestamp = 1;
  string line = 2;
}

message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}
`;
